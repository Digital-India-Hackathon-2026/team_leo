import { defaultModelRef, fallbackChain, fastChain, isMockMode } from "./registry.js";

/**
 * Model Crew roles. Fast roles (scout/summarizer/router) resolve to a cheap model;
 * heavy roles (brain/reviewer) to a strong one. The reviewer prefers a *different*
 * provider than the brain so a quality gate isn't graded by the same model family.
 * Every role honours a per-role env override; in mock mode every role is the mock.
 */
export type ModelRole = "scout" | "summarizer" | "brain" | "reviewer" | "router";

const ENV_OVERRIDE: Record<ModelRole, string> = {
  scout: "PERSONACODE_MODEL_SCOUT",
  summarizer: "PERSONACODE_MODEL_SUMMARIZER",
  brain: "PERSONACODE_MODEL_BRAIN",
  reviewer: "PERSONACODE_MODEL_REVIEWER",
  router: "PERSONACODE_MODEL_ROUTER",
};

const FAST_ROLES = new Set<ModelRole>(["scout", "summarizer", "router"]);

function providerOf(ref: string): string {
  return ref.slice(0, ref.indexOf("/"));
}

function safeDefault(): string {
  try {
    return defaultModelRef();
  } catch {
    return "mock/mock-1";
  }
}

export function modelForRole(role: ModelRole, opts?: { avoid?: string }): string {
  if (isMockMode()) return "mock/mock-1";
  const override = process.env[ENV_OVERRIDE[role]];
  if (override) return override;

  if (FAST_ROLES.has(role)) {
    const fast = fastChain();
    return fast[0] ?? safeDefault();
  }

  // brain / reviewer → strong default; reviewer avoids the brain's provider if it can.
  const chain = fallbackChain();
  if (role === "reviewer" && opts?.avoid) {
    const different = chain.find((r) => providerOf(r) !== providerOf(opts.avoid!));
    if (different) return different;
  }
  return chain[0] ?? safeDefault();
}

// Round-robin cursor for fan-out steps (summarizer briefs).
let cursor = 0;
export function nextParallelRef(_role: ModelRole = "summarizer"): string {
  if (isMockMode()) return "mock/mock-1";
  const fast = fastChain();
  if (fast.length === 0) return safeDefault();
  return fast[cursor++ % fast.length];
}

/** Reset the round-robin cursor (test hook). */
export function resetParallelCursor(): void {
  cursor = 0;
}
