#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { render } from "ink";
import App from "./App.js";
import { ensureServer } from "./server.js";

// Load .env from the nearest ancestor that has one, so keys are found no matter
// which directory `personacode`/`pnpm cli` is launched from (dotenv's default
// only checks cwd, which is apps/cli under pnpm — missing the repo-root .env).
(function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig({ quiet: true });
})();

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Personacode CLI\n\n" +
      "  pcode            Start the terminal chat (TUI)\n" +
      "  pcode --web      Open the local web app in your browser (starts the server if needed)\n" +
      "  pcode --help     Show this help\n"
  );
  process.exit(0);
}
const wantWeb = args.includes("--web") || args.includes("-w") || args[0] === "web";

/** Open a URL in the user's default browser (best-effort, cross-platform). */
function openBrowser(url: string): void {
  const [cmd, cmdArgs]: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort — the URL is printed regardless so the user can open it manually */
  }
}

// Route chat through the server so the CLI inherits PERSONA.md/memory, MCP tools,
// checkpoints, and auto-compaction. Reuse a running server or spawn one; fail-soft.
const srv = await ensureServer();
if (srv.error) {
  console.error(
    `⚠ ${srv.error}\n  Start it in another terminal with \`pnpm dev\` (or \`pnpm dev:mock\`), then run \`pcode\` again.`
  );
  process.exit(1);
}

// `pcode --web`: open the built web app (served by the same server) instead of the TUI.
if (wantWeb) {
  const res = await fetch(srv.base, { signal: AbortSignal.timeout(2500) }).catch(() => null);
  if (!res || res.status === 404) {
    console.error(
      "⚠ The web app isn't built yet. Run `pnpm build` (or `pnpm --filter @personacode/web build`), then `pcode --web`."
    );
    if (srv.started) srv.child?.kill();
    process.exit(1);
  }
  openBrowser(srv.base);
  console.log(`◆ Personacode web app → ${srv.base}${srv.mock ? "  (mock mode — no API keys needed)" : ""}`);
  if (srv.started) {
    console.log("  Server started by this command — press Ctrl+C to stop it.");
    const stop = () => {
      srv.child?.kill();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise<never>(() => {}); // keep the spawned server running until Ctrl+C
  } else {
    console.log("  (using the server already running — it keeps running after this exits)");
    process.exit(0);
  }
}

// Run in the terminal's alternate screen buffer (like opencode / vim / less):
// the CLI gets a clean fullscreen surface, and on exit the user's previous
// scrollback is restored intact — not wiped, just tucked back.
const ALT_ENTER = "\x1b[?1049h";
const ALT_LEAVE = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";
let restored = false;
function restoreScreen() {
  if (restored) return;
  restored = true;
  process.stdout.write(ALT_LEAVE + SHOW_CURSOR);
}

process.stdout.write(ALT_ENTER);
const { waitUntilExit } = render(<App base={srv.base} mock={srv.mock} />);

function shutdown() {
  restoreScreen();
  if (srv.started) srv.child?.kill(); // only kill a server we spawned
}

// Safety nets so the main screen is always restored, however we leave.
process.on("exit", shutdown);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

waitUntilExit().then(() => {
  shutdown();
  // Back on the user's normal shell prompt now — leave a short hint like Claude Code.
  console.log("Personacode session ended — run `pcode` to start again.");
  process.exit(0);
});
