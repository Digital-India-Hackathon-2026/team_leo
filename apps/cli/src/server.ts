import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultBase, getHealth } from "./api.js";

/** Walk up from `start` to find the monorepo root (has pnpm-workspace.yaml). */
export function findRepoRoot(start: string): string | null {
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
export async function ensureServer(opts: { host?: string } = {}): Promise<ServerHandle & { error?: string }> {
  const base = defaultBase();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const installedEntry = join(moduleDir, "runtime", "server.js");
  const root = findRepoRoot(process.cwd()) ?? findRepoRoot(moduleDir);
  const installed = existsSync(installedEntry);
  const workspace = process.env.PERSONACODE_WORKSPACE ?? (installed ? process.cwd() : root ?? process.cwd());
  const existing = await getHealth(base);
  if (existing) {
    if (existing.workspace && existing.workspace !== workspace) {
      return {
        base,
        mock: existing.mock,
        started: false,
        error: `server on ${base} is attached to ${existing.workspace}; run pcode --stop before opening ${workspace}`,
      };
    }
    return { base, mock: existing.mock, started: false };
  }

  const srcEntry = root ? join(root, "apps", "server", "src", "index.ts") : null;
  const distEntry = root ? join(root, "apps", "server", "dist", "index.js") : null;
  // Dev (repo checkout): run the source via tsx so it's always current. Installed /
  // built: run the compiled dist (no tsx runtime dependency needed).
  const spawnArgs =
    installed
      ? [installedEntry]
      : srcEntry && existsSync(srcEntry)
      ? ["--import", "tsx", srcEntry]
      : distEntry && existsSync(distEntry)
        ? [distEntry]
        : null;
  if (!spawnArgs) {
    return { base, mock: false, started: false, error: "server not running and could not locate the server to start" };
  }

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, spawnArgs, {
      cwd: installed ? process.cwd() : root!,
      env: {
        ...process.env,
        PERSONACODE_WORKSPACE: workspace,
        ...(installed ? { PERSONACODE_WEB_DIST: join(moduleDir, "runtime", "web") } : {}),
        // `pcode --web` passes host "0.0.0.0" so other devices on the LAN can reach it.
        ...(opts.host ? { PERSONACODE_HOST: opts.host } : {}),
      },
      stdio: "ignore",
      windowsHide: true,
      detached: true,
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
