/**
 * Standalone test harness for channel adapters — Dev C's daily driver.
 * Run: pnpm dev:channels   (from repo root)
 *
 * It starts every adapter marked available:true and echoes each inbound
 * message back with a fake-LLM reply, so adapters are testable end-to-end
 * WITHOUT any provider keys or the main server running.
 */
import "dotenv/config";
import { allAdapters } from "./index.js";

const fakeLlm = (text: string) =>
  `🤖 (personacode test harness) I received: "${text.slice(0, 200)}" — the real agent takes over once the server integration lands.`;

const active = allAdapters.filter((a) => a.available);
if (active.length === 0) {
  console.log("No adapters are available:true yet. Implement one (see AGENTS.md), flip its flag, and rerun.");
  process.exit(0);
}

for (const adapter of active) {
  console.log(`[harness] starting ${adapter.id}…`);
  adapter
    .start(async (msg) => {
      console.log(`[${msg.channel}] ${msg.from}: ${msg.text}`);
      await adapter.send(msg.conversationId, fakeLlm(msg.text));
    })
    .then(() => console.log(`[harness] ${adapter.id} running`))
    .catch((err) => console.error(`[harness] ${adapter.id} failed:`, err.message));
}

process.on("SIGINT", async () => {
  await Promise.all(active.map((a) => a.stop()));
  process.exit(0);
});
