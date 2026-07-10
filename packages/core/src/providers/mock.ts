import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

const CANNED = [
  "Hey! I'm the Personacode **mock model** — no API key needed. ",
  "Everything you see (streaming, sessions, usage, tools UI) works exactly like a real provider. ",
  "Add a free key via `/connect` or `.env` when you're ready. ",
  "Meanwhile: build UI against me fearlessly. 🚀",
];

/** Streams a canned markdown reply with realistic pacing + usage numbers. */
export function createMockModel(): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "text-start" as const, id: "t1" },
          ...CANNED.flatMap((sentence) =>
            sentence.split(/(?<= )/).map((word) => ({
              type: "text-delta" as const,
              id: "t1",
              delta: word,
            }))
          ),
          { type: "text-end" as const, id: "t1" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: {
              inputTokens: { total: 42, noCache: 42, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 60, text: 60, reasoning: undefined },
            },
          },
        ],
        initialDelayInMs: 120,
        chunkDelayInMs: 18,
      }),
    }),
  });
}
