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
      dotenvConfig({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
})();

render(<App />);
