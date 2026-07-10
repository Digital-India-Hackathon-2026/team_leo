import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultBase, getHealth } from "./api.js";

/** Walk up from `start` to find the monorepo root (has pnpm-workspace.yaml). */
function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface ServerHandle {
  base: string;
  mock: boolean;
  started: boolean; // true if we spawned it (and should kill on exit)
  child?: ChildProcess;
}

/**
 * Ensure a Personacode server is reachable. If one is already up we reuse it;
 * otherwise we spawn `node --import tsx apps/server/src/index.ts` from the repo
 * root and poll /api/health. Fail-soft: returns started:false if we can't spawn,
 * so the caller can tell the user to run `pnpm dev` manually.
 */
export async function ensureServer(): Promise<ServerHandle & { error?: string }> {
  const base = defaultBase();
  const existing = await getHealth(base);
  if (existing) return { base, mock: existing.mock, started: false };

  const root = findRepoRoot(process.cwd()) ?? findRepoRoot(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
  const entry = root ? join(root, "apps", "server", "src", "index.ts") : null;
  if (!root || !entry || !existsSync(entry)) {
    return { base, mock: false, started: false, error: "server not running and repo root not found" };
  }

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ["--import", "tsx", entry], {
      cwd: root,
      env: {
        ...process.env,
        PERSONACODE_WORKSPACE: process.env.PERSONACODE_WORKSPACE ?? root,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    return { base, mock: false, started: false, error: String((err as Error).message) };
  }

  // Poll health for up to ~15s.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const h = await getHealth(base);
    if (h) return { base, mock: h.mock, started: true, child };
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  return { base, mock: false, started: false, error: "server did not become healthy in time" };
}
