#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { render } from "ink";
import App from "./App.js";

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
const { waitUntilExit } = render(<App />);

// Safety nets so the main screen is always restored, however we leave.
process.on("exit", restoreScreen);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

waitUntilExit().then(() => {
  restoreScreen();
  // Back on the user's normal shell prompt now — leave a short hint like Claude Code.
  console.log("Personacode session ended — run `pcode` to start again.");
  process.exit(0);
});
