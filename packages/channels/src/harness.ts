/**
 * Standalone test harness for channel adapters — Dev C's daily driver.
 * Run: pnpm dev:channels   (from repo root)
 *
 * It starts every adapter marked available:true and echoes each inbound
 * message back with a fake-LLM reply, so adapters are testable end-to-end
 * WITHOUT any provider keys or the main server running.
 */
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Load .env from the nearest ancestor that has one — pnpm sets cwd to
// packages/channels/, so the default dotenv lookup would miss the root .env.
(function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig(); // fall back to default behavior
})();

// Dynamic import so adapter modules see the loaded env vars.
const { allAdapters } = await import("./index.js");

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

