import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import type { ModelMessage, UIMessage, UIMessageChunk } from "ai";
import type { Mode, TokenUsage } from "@personacode/contracts";
import { buildTools } from "../tools/index.js";
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
  system?: string;
  /** fires once, after the successful attempt fully streams */
  onFinishTurn?: (r: AgentTurnResult) => void | Promise<void>;
  onFallback?: (from: string, to: string, reason: string) => void;
}

function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("quota") ||
    m.includes("overloaded") ||
    m.includes("503") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("insufficient")
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
      const modelMessages = await convertToModelMessages(opts.messages);
      const chain = [primary, ...fallbackChain(primary)];
      let lastError = "";

      for (let i = 0; i < chain.length; i++) {
        const ref = chain[i];
        const messages: ModelMessage[] =
          i === 0
            ? modelMessages
            : [
                {
                  role: "system",
                  content: `HANDOFF: model ${chain[i - 1]} hit a provider limit mid-conversation. Continue seamlessly from the conversation state. Do NOT restart, re-plan, or repeat completed work.`,
                },
                ...modelMessages,
              ];

        let finished: AgentTurnResult | undefined;
        const result = streamText({
          model: getModel(ref),
          system: SYSTEM_PROMPT + MODE_HINTS[mode] + (opts.system ? `\n${opts.system}` : ""),
          messages,
          tools: buildTools({ mode, cwd, disabled: new Set(opts.disabledTools ?? []) }),
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
          for await (const chunk of result.toUIMessageStream({ sendStart: i === 0 })) {
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
        if (isQuotaError(errorText) && next) {
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
      if (!isQuotaError(msg)) throw err;
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
