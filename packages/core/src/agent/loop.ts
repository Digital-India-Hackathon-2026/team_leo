import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import type { ModelMessage, ToolSet, UIMessage, UIMessageChunk } from "ai";
import type { Mode, TokenUsage } from "@personacode/contracts";
import { buildTools } from "../tools/index.js";
import { compactConversation, shouldCompact } from "./compaction.js";
import { defaultModelRef, fallbackChain, getModel, setCooldown } from "../providers/registry.js";
import type { ProviderId } from "@personacode/contracts";

const SYSTEM_PROMPT = `You are Personacode, a capable, privacy-first coding and general agent running locally on the user's machine.
Be direct and helpful. Use tools when they get you facts; don't guess at file contents or command output.
When you finish multi-step work, summarize what you did in one short paragraph.`;

const MODE_HINTS: Record<Mode, string> = {
  default: "",
  plan: "\nYou are in PLAN mode: read-only. Investigate and produce a plan; do not modify anything.",
  auto: "\nYou are in AUTO mode: proceed autonomously without asking for confirmation.",
  edit: "\nYou are in EDIT mode: you may read and write files but must not run shell commands.",
};

export interface AgentTurnResult {
  text: string;
  usage: TokenUsage;
  modelRef: string;
}

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
  system?: string;
  /** fires once, after the successful attempt fully streams */
  onFinishTurn?: (r: AgentTurnResult) => void | Promise<void>;
  onFallback?: (from: string, to: string, reason: string) => void;
}

/**
 * Should this provider error trigger a fallback to the next provider?
 * Covers three families of "this provider can't serve the request" failures:
 *  - rate/quota limits (429, quota, overloaded, insufficient)
 *  - transient upstream outages (503, 500, overloaded)
 *  - auth / key problems (401/403, invalid or killed API key, permission denied)
 * A killed/invalid key surfaces as "API key not valid" (400) or 403 — the plan's
 * "kill the key to demo fallback" only works if those hand off instead of hard-failing.
 */
function shouldFallback(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("quota") ||
    m.includes("overloaded") ||
    m.includes("503") ||
    m.includes("500") ||
    m.includes("insufficient") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("permission denied") ||
    m.includes("api key not valid") ||
    m.includes("invalid api key") ||
    m.includes("api_key_invalid")
  );
}

function providerOf(ref: string): ProviderId {
  return ref.slice(0, ref.indexOf("/")) as ProviderId;
}

/**
 * Agent turn with streaming + provider fallback + context handoff.
 *
 * We pump each attempt's UIMessage stream manually: on an error chunk from a
 * quota/rate-limit failure we cool the provider down for 5 min and retry the
 * turn on the next configured provider, prepending a handoff note so the new
 * model continues instead of restarting. Returns a UIMessage chunk stream the
 * server wraps with createUIMessageStreamResponse().
 */
export function runAgentTurn(opts: AgentRunOptions): ReadableStream<UIMessageChunk> {
  const mode: Mode = opts.mode ?? "default";
  const cwd = opts.cwd ?? process.cwd();
  const primary = opts.modelRef ?? defaultModelRef();

  return createUIMessageStream({
    execute: async ({ writer }) => {
      let modelMessages = await convertToModelMessages(opts.messages);

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

      const chain = [primary, ...fallbackChain(primary)];
      let lastError = "";

      for (let i = 0; i < chain.length; i++) {
        const ref = chain[i];
        // The handoff brief must go in the `system` instructions, NOT as a system
        // message inside `messages` — AI SDK v7 rejects system-role messages there
        // (InvalidPromptError), which would make every fallback attempt fail.
        const handoffNote =
          i === 0
            ? ""
            : `\n\nHANDOFF: model ${chain[i - 1]} hit a provider limit mid-conversation. Continue seamlessly from the conversation state. Do NOT restart, re-plan, or repeat completed work.`;

        let finished: AgentTurnResult | undefined;
        const result = streamText({
          model: getModel(ref),
          system:
            SYSTEM_PROMPT +
            MODE_HINTS[mode] +
            (opts.system ? `\n${opts.system}` : "") +
            (compactionBrief ? `\n\n${compactionBrief}` : "") +
            handoffNote,
          messages: modelMessages,
          tools: {
            ...buildTools({ mode, cwd, disabled: new Set(opts.disabledTools ?? []) }),
            ...(opts.extraTools ?? {}),
          },
          stopWhen: stepCountIs(16),
          onFinish: ({ text, totalUsage }) => {
            finished = {
              text,
              modelRef: ref,
              usage: {
                inputTokens: totalUsage.inputTokens ?? 0,
                outputTokens: totalUsage.outputTokens ?? 0,
                totalTokens: totalUsage.totalTokens ?? 0,
              },
            };
          },
        });

        let errorText: string | undefined;
        try {
          // onError surfaces the REAL provider message in the error chunk; without it
          // the SDK masks every failure as "An error occurred", so shouldFallback()
          // could never see "429"/"api key not valid" and fallback never fired.
          for await (const chunk of result.toUIMessageStream({
            sendStart: i === 0,
            onError: (err) => (err instanceof Error ? err.message : String(err)),
          })) {
            if (chunk.type === "error") {
              errorText = chunk.errorText;
              break;
            }
            writer.write(chunk);
          }
        } catch (err) {
          errorText = String((err as Error)?.message ?? err);
        }

        if (errorText === undefined) {
          if (finished) await opts.onFinishTurn?.(finished);
          return;
        }

        lastError = errorText;
        const next = chain[i + 1];
        if (shouldFallback(errorText) && next) {
          setCooldown(providerOf(ref), 5 * 60_000);
          opts.onFallback?.(ref, next, errorText);
          writer.write({
            type: "data-fallback",
            data: { from: ref, to: next, reason: errorText },
          } as unknown as UIMessageChunk);
          continue;
        }
        writer.write({ type: "error", errorText });
        return;
      }
      writer.write({ type: "error", errorText: `All providers failed. Last error: ${lastError}` });
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
