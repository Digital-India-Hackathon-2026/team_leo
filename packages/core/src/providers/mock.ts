import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import type { LanguageModelV3StreamPart, LanguageModelV3CallOptions } from "@ai-sdk/provider";

const CANNED = [
  "Hey! I'm the Personacode **mock model** — no API key needed. ",
  "Everything you see (streaming, sessions, usage, tools UI) works exactly like a real provider. ",
  "Add a free key via `/connect` or `.env` when you're ready. ",
  "Meanwhile: build UI against me fearlessly. 🚀",
];

const USAGE = {
  inputTokens: { total: 42, noCache: 42, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 60, text: 60, reasoning: undefined },
} as const;

/** Last user message text from the model prompt (for the tool-call trigger). */
function lastUserText(prompt: LanguageModelV3CallOptions["prompt"]): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    return m.content.map((p) => (p.type === "text" ? p.text : "")).join(" ");
  }
  return "";
}

/**
 * Which builtin tool (if any) should the mock call for this prompt? Lets teammates
 * demo tool cards + permission prompts with `pnpm dev:mock` (no keys). We only fire
 * on the FIRST pass — once a tool result is in the prompt we conclude with text so
 * the agent loop doesn't spin.
 */
function triggeredTool(prompt: LanguageModelV3CallOptions["prompt"]): { name: string; input: unknown } | null {
  if (prompt.some((m) => m.role === "tool")) return null;
  const text = lastUserText(prompt).toLowerCase();
  if (/\bwrite\b.*\bfile\b|create a file/.test(text))
    return { name: "write_file", input: { path: "mock-note.txt", content: "written by the mock tool" } };
  if (/\b(run|exec|execute)\b.*\b(bash|command|shell)\b|run bash|list files/.test(text))
    return { name: "bash", input: { command: 'echo "hello from the mock tool"' } };
  return null;
}

/** Streams a canned markdown reply — or a tool call when the prompt asks for one. */
export function createMockModel(): LanguageModel {
  return new MockLanguageModelV3({
    // Non-streaming path (generateText): used by compaction, /compare, title routing.
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: CANNED.join("") }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: USAGE,
      warnings: [],
    }),
    doStream: async (options: LanguageModelV3CallOptions) => {
      const tool = triggeredTool(options.prompt);
      if (tool) {
        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: "tool-call" as const, toolCallId: "mockcall1", toolName: tool.name, input: JSON.stringify(tool.input) },
              { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: USAGE },
            ],
            initialDelayInMs: 80,
            chunkDelayInMs: 12,
          }),
        };
      }
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "text-start" as const, id: "t1" },
            ...CANNED.flatMap((sentence) =>
              sentence.split(/(?<= )/).map((word) => ({ type: "text-delta" as const, id: "t1", delta: word }))
            ),
            { type: "text-end" as const, id: "t1" },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: USAGE },
          ],
          initialDelayInMs: 120,
          chunkDelayInMs: 18,
        }),
      };
    },
  });
}
