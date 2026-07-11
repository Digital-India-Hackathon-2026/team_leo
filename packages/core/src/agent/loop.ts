import { convertToModelMessages, createUIMessageStream, generateText } from "ai";
import type { ToolSet, UIMessage, UIMessageChunk } from "ai";
import type { LanguageCode, Mode } from "@personacode/contracts";
import { buildTools } from "../tools/index.js";
import { compactConversation, shouldCompact } from "./compaction.js";
import { runScout } from "./scout.js";
import { runFinishHooks } from "../hooks/index.js";
import { captureReviewBaseline, reviewAgentResult } from "./reviewer.js";
import { routeAutoTask } from "./router.js";
import { defaultModelRef, fallbackChain, getModel, setCooldown } from "../providers/registry.js";
import {
  MODE_HINTS,
  SYSTEM_PROMPT,
  TERSE_SYSTEM_PROMPT,
  lastUserText,
  providerOf,
  pumpTurn,
  shouldFallback,
  responseDirectives,
  type AgentTurnResult,
} from "./turn.js";

export type { AgentTurnResult } from "./turn.js";

export interface AgentRunOptions {
  messages: UIMessage[];
  modelRef?: string;
  mode?: Mode;
  cwd?: string;
  disabledTools?: string[];
  /** Extra tools (e.g. from MCP servers) merged with the builtins for this turn. */
  extraTools?: ToolSet;
  /** Auto-compact the history when it nears the model's context window (default true). */
  autoCompact?: boolean;
  /** Model Crew: run the scout→brief pipeline before the brain turn (opt-in). */
  orchestrate?: boolean;
  /** Bharat Mode response language. */
  language?: LanguageCode;
  /** Terse Mode response compression. */
  terse?: boolean;
  /**
   * Permission approval channel for side-effecting tools in Default mode. The host
   * resolves each request id with a decision; core emits a `data-permission-request`
   * chunk and awaits it. "always" auto-approves that tool for the rest of the turn.
   */
  approval?: {
    waitForDecision: (id: string, meta: { tool: string; input: unknown }) => Promise<"allow" | "deny" | "always">;
  };
  system?: string;
  /** fires once, after the successful attempt fully streams */
  onFinishTurn?: (r: AgentTurnResult) => void | Promise<void>;
  onFallback?: (from: string, to: string, reason: string) => void;
}

/**
 * Agent turn with streaming + provider fallback + context handoff.
 *
 * Assembles the system prompt (mode hints + injected context + optional Model Crew
 * brief + compaction summary), builds the tool set with the permission gate, then
 * delegates the streaming + fallback pump to {@link pumpTurn}. Returns a UIMessage
 * chunk stream the server wraps with createUIMessageStreamResponse().
 */
export function runAgentTurn(opts: AgentRunOptions): ReadableStream<UIMessageChunk> {
  const mode: Mode = opts.mode ?? "default";
  const cwd = opts.cwd ?? process.cwd();

  return createUIMessageStream({
    execute: async ({ writer }) => {
      let modelMessages = await convertToModelMessages(opts.messages);
      let primary = opts.modelRef ?? defaultModelRef();
      let routingPreset = "";
      let routeUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      if (mode === "auto") {
        const route = await routeAutoTask(lastUserText(opts.messages));
        primary = route.model;
        routingPreset = `\n\n${route.preset}`;
        routeUsage = route.usage;
        writer.write({
          type: "data-orchestration",
          data: {
            stage: "route",
            model: route.model,
            ms: route.ms,
            detail: `${route.kind}: ${route.reason}`,
            kind: route.kind,
            mode: route.mode,
          },
        } as unknown as UIMessageChunk);
      }

      // Build the tool-approval gate: emit a request chunk, await the host's decision.
      // "always" auto-approves that tool for the remainder of this turn.
      const alwaysAllow = new Set<string>();
      const requestApproval = opts.approval
        ? async ({ tool, input }: { tool: string; input: unknown }): Promise<boolean> => {
            if (alwaysAllow.has(tool)) return true;
            const id = crypto.randomUUID();
            writer.write({ type: "data-permission-request", data: { id, tool, input } } as unknown as UIMessageChunk);
            const decision = await opts.approval!.waitForDecision(id, { tool, input });
            if (decision === "always") {
              alwaysAllow.add(tool);
              return true;
            }
            return decision === "allow";
          }
        : undefined;

      // Model Crew orchestration (opt-in): a fast scout picks relevant files and fast
      // summarizers brief them in parallel; the brief is injected so the brain starts
      // with context already known. Strictly additive — any failure just skips it.
      let orchestrationBrief = "";
      let crewActive = false;
      if (opts.orchestrate) {
        try {
          const task = lastUserText(opts.messages);
          const scout = await runScout({ cwd, task });
          if (scout) {
            crewActive = true;
            for (const st of scout.stages) {
              writer.write({ type: "data-orchestration", data: st } as unknown as UIMessageChunk);
            }
            if (scout.brief) {
              orchestrationBrief = `\n\nCONTEXT BRIEF (gathered by Model Crew scout — files already read, don't re-read them):\n${scout.brief}`;
            }
          }
        } catch {
          /* orchestration is additive; fall through to the normal turn */
        }
      }

      // Auto-compaction: if the history nears the context window, summarize the older
      // turns and carry the brief in the system prompt (fail-soft — keep full history
      // if summarization fails). Emitted as a data-compaction chunk for the UI.
      let compactionBrief = "";
      if (opts.autoCompact !== false && shouldCompact(modelMessages, primary)) {
        const r = await compactConversation({ messages: modelMessages, modelRef: primary });
        if (r.compacted) {
          modelMessages = r.messages;
          compactionBrief = r.summary;
          writer.write({
            type: "data-compaction",
            data: { keptRecent: modelMessages.length, note: "history auto-compacted" },
          } as unknown as UIMessageChunk);
        }
      }

      const baseSystem =
        (opts.terse ? TERSE_SYSTEM_PROMPT : SYSTEM_PROMPT) +
        MODE_HINTS[mode] +
        (opts.system ? `\n${opts.system}` : "") +
        (compactionBrief ? `\n\n${compactionBrief}` : "") +
        orchestrationBrief +
        routingPreset +
        responseDirectives(opts.language, opts.terse);
      const tools: ToolSet = {
        ...buildTools({ mode, cwd, disabled: new Set(opts.disabledTools ?? []), requestApproval }),
        ...(opts.extraTools ?? {}),
      };
      const reviewBaseline = crewActive ? await captureReviewBaseline(cwd) : undefined;

      const { result, error } = await pumpTurn({
        writer,
        modelMessages,
        baseSystem,
        tools,
        primary,
        sendStart: true,
        onFallback: opts.onFallback,
      });
      if (error !== undefined) {
        writer.write({ type: "error", errorText: error });
        return;
      }
      if (result) {
        result.usage.inputTokens += routeUsage.inputTokens;
        result.usage.outputTokens += routeUsage.outputTokens;
        result.usage.totalTokens += routeUsage.totalTokens;
        if (crewActive) {
          const review = await reviewAgentResult({
            cwd,
            task: lastUserText(opts.messages),
            result: result.text,
            avoidModel: result.modelRef,
            baseline: reviewBaseline,
          });
          result.usage.inputTokens += review.usage.inputTokens;
          result.usage.outputTokens += review.usage.outputTokens;
          result.usage.totalTokens += review.usage.totalTokens;
          writer.write({
            type: "data-orchestration",
            data: {
              stage: "review",
              model: review.model,
              ms: review.ms,
              detail: `${review.passed ? "passed" : "issues found"}: ${review.critique}`,
            },
          } as unknown as UIMessageChunk);
        }
        if (mode !== "plan") await runFinishHooks(cwd, { result }).catch(() => undefined);
        await opts.onFinishTurn?.(result);
      }
    },
  });
}

/** Non-streaming completion with full retry across the chain (titles, routing). */
export async function generateWithFallback(prompt: string, modelRef?: string) {
  const primary = modelRef ?? defaultModelRef();
  const chain = [primary, ...fallbackChain(primary)];
  let lastError: unknown;
  for (const ref of chain) {
    const started = Date.now();
    try {
      const { text, totalUsage } = await generateText({ model: getModel(ref), prompt });
      return {
        model: ref,
        text,
        ms: Date.now() - started,
        usage: {
          inputTokens: totalUsage.inputTokens ?? 0,
          outputTokens: totalUsage.outputTokens ?? 0,
          totalTokens: totalUsage.totalTokens ?? 0,
        },
      };
    } catch (err) {
      lastError = err;
      const msg = String((err as Error)?.message ?? err);
      if (!shouldFallback(msg)) throw err;
      setCooldown(providerOf(ref), 5 * 60_000);
    }
  }
  throw new Error(`All providers failed: ${String((lastError as Error)?.message ?? lastError)}`);
}

/** Compare: same prompt on N models in parallel, errors reported per-model. */
export async function compareModels(prompt: string, refs: string[]) {
  return Promise.all(
    refs.map(async (ref) => {
      const started = Date.now();
      try {
        const { text, totalUsage } = await generateText({ model: getModel(ref), prompt });
        return {
          model: ref,
          text,
          ms: Date.now() - started,
          usage: {
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
            totalTokens: totalUsage.totalTokens ?? 0,
          },
        };
      } catch (err) {
        return { model: ref, text: "", ms: Date.now() - started, error: String((err as Error).message) };
      }
    })
  );
}
