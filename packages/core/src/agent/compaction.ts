import type { ModelMessage } from "ai";
import { generateText } from "ai";
import { getModel, contextWindowFor, defaultModelRef, fallbackChain } from "../providers/registry.js";

/**
 * Auto-compaction: when a conversation grows past a fraction of the model's context
 * window we summarize the older turns into a compact brief and keep only the most
 * recent messages verbatim. The brief is carried forward via the `system` option
 * (AI SDK v7 rejects system-role messages inside `messages`), so the model continues
 * with the gist of the history instead of the full (and possibly context-rotted) log.
 */
const CHARS_PER_TOKEN = 4;
export const COMPACT_THRESHOLD = 0.7; // compact once we exceed 70% of the window
const KEEP_RECENT = 6;

function messageText(m: ModelMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => {
        const part = p as { type?: string; text?: string };
        return part.type === "text" ? part.text ?? "" : `[${part.type}]`;
      })
      .join(" ");
  }
  return "";
}

/** Rough token estimate (chars/4) — no tokenizer dependency needed for a threshold check. */
export function approxTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += messageText(m).length + 8; // +role overhead
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export interface CompactionResult {
  messages: ModelMessage[];
  /** brief to append to the system prompt; empty when nothing was compacted */
  summary: string;
  compacted: boolean;
}

/** Summarize the older messages, keeping the last `keepRecent` verbatim. Fail-soft. */
export async function compactConversation(opts: {
  messages: ModelMessage[];
  modelRef?: string;
  keepRecent?: number;
}): Promise<CompactionResult> {
  const { messages } = opts;
  const keepRecent = opts.keepRecent ?? KEEP_RECENT;
  if (messages.length <= keepRecent + 1) {
    return { messages, summary: "", compacted: false };
  }

  const older = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(messages.length - keepRecent);
  const transcript = older.map((m) => `${m.role.toUpperCase()}: ${messageText(m)}`).join("\n");

  const prompt =
    "Summarize the following conversation so another model can continue seamlessly. " +
    "Capture: the user's goals, decisions made, files/commands touched, and current task state. " +
    "Be concise but keep every fact needed to continue. Do NOT add commentary.\n\n" +
    transcript;

  // Use a fast model from the chain to summarize; fall back across providers.
  const primary = opts.modelRef ?? defaultModelRef();
  const chain = [primary, ...fallbackChain(primary)];
  for (const ref of chain) {
    try {
      const { text } = await generateText({ model: getModel(ref), prompt });
      if (text.trim()) {
        return {
          messages: recent,
          summary: `# Conversation summary (auto-compacted from ${older.length} earlier messages)\n${text.trim()}`,
          compacted: true,
        };
      }
    } catch {
      /* try next provider */
    }
  }
  // Summarization failed everywhere — proceed uncompacted rather than lose context.
  return { messages, summary: "", compacted: false };
}

/** Decide whether a conversation should be auto-compacted for `modelRef`. */
export function shouldCompact(messages: ModelMessage[], modelRef: string): boolean {
  return approxTokens(messages) > COMPACT_THRESHOLD * contextWindowFor(modelRef);
}
