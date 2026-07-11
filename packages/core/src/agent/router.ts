import { generateText } from "ai";
import type { AutoTaskKind, Mode, TokenUsage } from "@personacode/contracts";
import { fastChain, getModel, isMockMode, listModels } from "../providers/registry.js";
import { modelForRole } from "../providers/roles.js";

export interface AutoRouteResult {
  kind: AutoTaskKind;
  model: string;
  mode: Mode;
  preset: string;
  reason: string;
  ms: number;
  usage: TokenUsage;
}

function heuristicKind(task: string): AutoTaskKind {
  if (/\b(whole codebase|entire repo|many files|long[ -]?context|large document|large repo)\b/i.test(task)) return "long-context";
  if (/\b(research|search|sources?|latest|current|compare evidence|investigate online)\b/i.test(task)) return "research";
  if (/\b(code|file|function|class|bug|fix|implement|refactor|test|build|error|typescript|javascript|python)\b/i.test(task)) return "code";
  return "chat";
}

function targetModel(kind: AutoTaskKind): string {
  const models = listModels();
  if (kind === "code") {
    return models.find((model) => /coder|code/i.test(model.modelId))?.ref ??
      models.find((model) => /qwen|gpt-oss|deepseek/i.test(model.modelId))?.ref ??
      modelForRole("brain");
  }
  if (kind === "research" || kind === "long-context") {
    return [...models].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0]?.ref ?? modelForRole("brain");
  }
  return fastChain()[0] ?? models[0]?.ref ?? modelForRole("brain");
}

function presetFor(kind: AutoTaskKind): string {
  switch (kind) {
    case "code":
      return "AUTO ROUTE — CODE: inspect relevant files, make the smallest correct change, and verify it.";
    case "research":
      return "AUTO ROUTE — RESEARCH: search iteratively, prefer primary sources, cross-check important claims, and cite URLs.";
    case "long-context":
      return "AUTO ROUTE — LONG CONTEXT: synthesize the full supplied context before acting; preserve important constraints and contradictions.";
    default:
      return "AUTO ROUTE — CHAT: answer directly; use tools only when they materially improve accuracy.";
  }
}

function parseKind(text: string): { kind: AutoTaskKind; reason: string } | undefined {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[0]) as { kind?: unknown; reason?: unknown };
    if (!(["code", "chat", "research", "long-context"] as unknown[]).includes(value.kind)) return undefined;
    return {
      kind: value.kind as AutoTaskKind,
      reason: typeof value.reason === "string" ? value.reason.slice(0, 240) : "classified by router",
    };
  } catch {
    return undefined;
  }
}

export async function routeAutoTask(task: string): Promise<AutoRouteResult> {
  const started = Date.now();
  let kind = heuristicKind(task);
  let reason = "deterministic task heuristic";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  if (!isMockMode()) {
    try {
      const result = await generateText({
        model: getModel(modelForRole("router")),
        prompt:
          `Classify this request for an agent router. Return ONLY JSON: ` +
          `{"kind":"code|chat|research|long-context","reason":"short reason"}.\n\nREQUEST:\n${task.slice(0, 6_000)}`,
      });
      const parsed = parseKind(result.text);
      if (parsed) ({ kind, reason } = parsed);
      usage = {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        totalTokens: result.totalUsage.totalTokens ?? 0,
      };
    } catch {
      // Routing is fail-soft: the deterministic heuristic still selects a usable preset/model.
    }
  }

  return {
    kind,
    model: targetModel(kind),
    mode: "auto",
    preset: presetFor(kind),
    reason,
    ms: Date.now() - started,
    usage,
  };
}
