import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelInfo, ProviderId, ProviderInfo } from "@personacode/contracts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createMockModel } from "./mock.js";

type CatalogEntry = Omit<ProviderInfo, "configured" | "coolingDownUntil"> & {
  contextWindows?: Record<string, number>;
};

const catalogPath = join(dirname(fileURLToPath(import.meta.url)), "providers.json");
const catalog: { providers: CatalogEntry[] } = JSON.parse(readFileSync(catalogPath, "utf8"));

export function isMockMode(): boolean {
  return process.env.PERSONACODE_MOCK === "1" || process.env.PERSONACODE_MOCK === "true";
}

function hasKey(entry: CatalogEntry): boolean {
  if (entry.id === "ollama") return Boolean(process.env.OLLAMA_BASE_URL);
  return Boolean(process.env[entry.envVar]);
}

/** Catalog + runtime configured state (never the key itself). */
export function listProviders(): ProviderInfo[] {
  return catalog.providers.map(({ contextWindows: _cw, ...p }) => ({
    ...p,
    configured: hasKey(p as CatalogEntry),
    coolingDownUntil: getCooldown(p.id),
  }));
}

/** Flat model list across configured providers (all providers in mock mode). */
export function listModels(): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const p of catalog.providers) {
    if (!isMockMode() && !hasKey(p)) continue;
    for (const modelId of p.models) {
      models.push({
        providerId: p.id,
        modelId,
        ref: `${p.id}/${modelId}`,
        contextWindow: p.contextWindows?.[modelId],
      });
    }
  }
  if (isMockMode()) {
    models.unshift({ providerId: "mock", modelId: "mock-1", ref: "mock/mock-1", contextWindow: 128000 });
  }
  return models;
}

export function contextWindowFor(ref: string): number {
  const m = listModels().find((x) => x.ref === ref);
  return m?.contextWindow ?? 128000;
}

/** "google/gemini-2.5-flash" → LanguageModel instance. */
export function getModel(ref: string): LanguageModel {
  const slash = ref.indexOf("/");
  const providerId = ref.slice(0, slash) as ProviderId;
  const modelId = ref.slice(slash + 1);
  if (providerId === "mock" || isMockMode()) return createMockModel();

  const entry = catalog.providers.find((p) => p.id === providerId);
  if (!entry) throw new Error(`Unknown provider: ${providerId}`);
  const apiKey = process.env[entry.envVar];

  switch (providerId) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "groq":
      return createGroq({ apiKey })(modelId);
    case "ollama":
      return createOpenAICompatible({
        name: entry.id,
        baseURL: process.env.OLLAMA_BASE_URL ?? entry.baseUrl!,
        apiKey: "ollama",
      })(modelId);
    default:
      // cerebras, openrouter, nvidia, github, zen — all OpenAI-compatible
      return createOpenAICompatible({ name: entry.id, baseURL: entry.baseUrl!, apiKey })(modelId);
  }
}

/** Default model ref: first configured provider in priority order. */
export function defaultModelRef(): string {
  if (isMockMode()) return "mock/mock-1";
  for (const p of catalog.providers) {
    if (hasKey(p)) return `${p.id}/${p.defaultModel}`;
  }
  throw new Error(
    "No provider configured. Copy .env.example to .env and add at least one free key (see /connect), or run with PERSONACODE_MOCK=1."
  );
}

// ---------- cooldown state (in-memory; fallback.ts drives it) ----------

const cooldowns = new Map<ProviderId, number>();

export function setCooldown(id: ProviderId, ms: number): void {
  cooldowns.set(id, Date.now() + ms);
}

export function getCooldown(id: ProviderId): number | undefined {
  const until = cooldowns.get(id);
  if (until && until > Date.now()) return until;
  return undefined;
}

/** Fallback chain: configured providers in catalog priority order, skipping cooldowns. */
export function fallbackChain(excludeRef?: string): string[] {
  const chain: string[] = [];
  for (const p of catalog.providers) {
    if (!isMockMode() && !hasKey(p)) continue;
    if (getCooldown(p.id)) continue;
    const ref = `${p.id}/${p.defaultModel}`;
    if (ref !== excludeRef) chain.push(ref);
  }
  return chain;
}
