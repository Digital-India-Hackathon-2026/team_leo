import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { TokenUsage } from "@personacode/contracts";
import { isMockMode } from "../providers/registry.js";
import { modelForRole } from "../providers/roles.js";
import { generateWithFallback } from "./loop.js";
import { providerOf } from "./turn.js";
import { resolveWorkspacePath } from "../security/paths.js";

const execFileAsync = promisify(execFile);
const MAX_REVIEW_INPUT = 12_000;

export interface ReviewResult {
  passed: boolean;
  critique: string;
  model: string;
  ms: number;
  usage: TokenUsage;
  available: boolean;
}

export type ReviewBaseline = Map<string, string>;

const REVIEW_IGNORE = new Set(["node_modules", ".git", ".personacode", "dist", "build", "coverage", ".turbo", ".next"]);

async function reviewPaths(cwd: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (REVIEW_IGNORE.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else paths.push(relative(cwd, full).replace(/\\/g, "/"));
    }
  }
  await walk(cwd);
  return paths.sort();
}

export async function captureReviewBaseline(cwd: string): Promise<ReviewBaseline> {
  const paths = await reviewPaths(cwd);
  const rows = await Promise.all(
    paths.map(async (path) => {
      try {
        const content = await readFile(await resolveWorkspacePath(cwd, path));
        return [path, createHash("sha256").update(content).digest("hex")] as const;
      } catch {
        return undefined;
      }
    }),
  );
  return new Map(rows.filter((row): row is readonly [string, string] => row !== undefined));
}

async function changesSince(cwd: string, baseline: ReviewBaseline): Promise<string> {
  const paths = await reviewPaths(cwd);
  const current = new Set(paths);
  const changes: Array<{ path: string; status: "modified" | "created" | "deleted"; text: string }> = [];
  for (const path of paths) {
    try {
      const full = await resolveWorkspacePath(cwd, path);
      const content = await readFile(full);
      const hash = createHash("sha256").update(content).digest("hex");
      if (baseline.get(path) === hash) continue;
      changes.push({
        path,
        status: baseline.has(path) ? "modified" : "created",
        text: content.toString("utf8"),
      });
    } catch {
      // Skip binary/unreadable files; deterministic verification still covers the turn.
    }
  }
  for (const path of baseline.keys()) {
    if (!current.has(path)) changes.push({ path, status: "deleted", text: "" });
  }
  if (!changes.length) return "";
  const summary = changes.map((change) => `- ${change.path} (${change.status})`).join("\n").slice(0, MAX_REVIEW_INPUT / 2);
  const detailBudget = Math.max(0, MAX_REVIEW_INPUT - summary.length - 32);
  const perFile = changes.length ? Math.floor(detailBudget / changes.length) : 0;
  const details = changes
    .map((change) => `## ${change.path}\n${change.text.slice(0, Math.min(5_000, perFile))}`)
    .join("\n\n");
  return `CHANGED FILES:\n${summary}\n\nDETAILS:\n${details}`.slice(0, MAX_REVIEW_INPUT);
}

async function workspaceDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--no-ext-diff", "--", "."], {
      cwd,
      timeout: 15_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    });
    return stdout.slice(-MAX_REVIEW_INPUT);
  } catch {
    return "";
  }
}

function parseVerdict(text: string): { passed: boolean; critique: string } | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[0]) as { passed?: unknown; critique?: unknown };
    if (typeof value.passed !== "boolean" || typeof value.critique !== "string") return undefined;
    return { passed: value.passed, critique: value.critique.trim().slice(0, 4_000) };
  } catch {
    return undefined;
  }
}

export async function reviewAgentResult(opts: {
  cwd: string;
  task: string;
  result: string;
  plan?: string;
  avoidModel?: string;
  baseline?: ReviewBaseline;
}): Promise<ReviewResult> {
  if (isMockMode()) {
    return {
      passed: true,
      critique: "(mock) reviewer found no blocking issues",
      model: "mock/mock-1",
      ms: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      available: true,
    };
  }

  const started = Date.now();
  const diff = opts.baseline ? await changesSince(opts.cwd, opts.baseline) : await workspaceDiff(opts.cwd);
  const prompt =
    `You are the REVIEWER quality gate for a coding agent. Review only for concrete correctness, security, regressions, and whether the requested task was achieved. Do not demand optional polish.\n\n` +
    `TASK:\n${opts.task}\n\n` +
    (opts.plan ? `PLAN:\n${opts.plan.slice(0, 5_000)}\n\n` : "") +
    `AGENT RESULT:\n${opts.result.slice(-5_000)}\n\n` +
    `TURN CHANGES:\n${diff || "(no workspace changes detected)"}\n\n` +
    `Return exactly one JSON object: {"passed":true|false,"critique":"brief actionable reason"}. ` +
    `Set passed=false only for a blocking defect that should be fixed before completion.`;

  try {
    const reviewer = modelForRole("reviewer", {
      avoid: opts.avoidModel ? providerOf(opts.avoidModel) : undefined,
    });
    const response = await generateWithFallback(prompt, reviewer);
    const verdict = parseVerdict(response.text);
    if (!verdict) throw new Error("reviewer returned an invalid verdict");
    return { ...verdict, model: response.model, ms: Date.now() - started, usage: response.usage, available: true };
  } catch (error) {
    return {
      passed: true,
      critique: `review unavailable: ${error instanceof Error ? error.message : String(error)}`,
      model: "unavailable",
      ms: Date.now() - started,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      available: false,
    };
  }
}
