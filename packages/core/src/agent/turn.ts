import { stepCountIs, streamText } from "ai";
import type { ModelMessage, ToolSet, UIMessage, UIMessageChunk } from "ai";
import type { Mode, TokenUsage } from "@personacode/contracts";
import type { ProviderId } from "@personacode/contracts";
import { fallbackChain, getModel, setCooldown } from "../providers/registry.js";

export const SYSTEM_PROMPT = `You are Personacode, a capable, privacy-first coding and general agent running locally on the user's machine.
Be direct and helpful. Use tools when they get you facts; don't guess at file contents or command output.
When you finish multi-step work, summarize what you did in one short paragraph.`;

export const MODE_HINTS: Record<Mode, string> = {
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

/**
 * Should this provider error trigger a fallback to the next provider?
 * Covers three families of "this provider can't serve the request" failures:
 *  - rate/quota limits (429, quota, overloaded, insufficient)
 *  - transient upstream outages (503, 500, overloaded)
 *  - auth / key problems (401/403, invalid or killed API key, permission denied)
 * A killed/invalid key surfaces as "API key not valid" (400) or 403 — the plan's
 * "kill the key to demo fallback" only works if those hand off instead of hard-failing.
 */
export function shouldFallback(msg: string): boolean {
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

export function providerOf(ref: string): ProviderId {
  return ref.slice(0, ref.indexOf("/")) as ProviderId;
}

/** Text of the most recent user message (for scout task + memory recall). */
export function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return (last?.parts ?? [])
    .map((p) => ((p as { type: string; text?: string }).type === "text" ? (p as { text?: string }).text ?? "" : ""))
    .join(" ");
}

/** Minimal writer surface both runAgentTurn and the PAV loop pass in. */
export interface StreamWriter {
  write: (chunk: UIMessageChunk) => void;
}

export interface PumpTurnArgs {
  writer: StreamWriter;
  modelMessages: ModelMessage[];
  /** Full system text EXCEPT the per-attempt handoff note (this adds it internally). */
  baseSystem: string;
  tools: ToolSet;
  primary: string;
  /** Emit the UIMessage `start` frame on the first attempt (false for later PAV turns). */
  sendStart: boolean;
  maxSteps?: number;
  onFallback?: (from: string, to: string, reason: string) => void;
}

/**
 * One streaming model turn with provider fallback + context handoff, written into
 * a shared UIMessage stream `writer`. Extracted from runAgentTurn so the PAV loop
 * can reuse the exact same fallback/handoff behaviour for each Apply pass.
 *
 * We pump each attempt's UIMessage stream manually: on an error chunk from a
 * quota/rate-limit failure we cool the provider down for 5 min and retry on the
 * next configured provider, prepending a handoff note so the new model continues
 * instead of restarting. Returns the finished result, or an error string if the
 * whole chain failed (the caller decides how to surface it).
 */
export async function pumpTurn(a: PumpTurnArgs): Promise<{ result?: AgentTurnResult; error?: string }> {
  const chain = [a.primary, ...fallbackChain(a.primary)];
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
      system: a.baseSystem + handoffNote,
      messages: a.modelMessages,
      tools: a.tools,
      stopWhen: stepCountIs(a.maxSteps ?? 16),
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
        sendStart: a.sendStart && i === 0,
        onError: (err) => (err instanceof Error ? err.message : String(err)),
      })) {
        if (chunk.type === "error") {
          errorText = chunk.errorText;
          break;
        }
        a.writer.write(chunk);
      }
    } catch (err) {
      errorText = String((err as Error)?.message ?? err);
    }

    if (errorText === undefined) return { result: finished };

    lastError = errorText;
    const next = chain[i + 1];
    if (shouldFallback(errorText) && next) {
      setCooldown(providerOf(ref), 5 * 60_000);
      a.onFallback?.(ref, next, errorText);
      a.writer.write({
        type: "data-fallback",
        data: { from: ref, to: next, reason: errorText },
      } as unknown as UIMessageChunk);
      continue;
    }
    return { error: errorText };
  }
  return { error: `All providers failed. Last error: ${lastError}` };
}
