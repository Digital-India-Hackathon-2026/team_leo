import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PAV Loop — Verify stage. We do NOT run arbitrary model-suggested shell: the
 * verify commands come deterministically from the repo's own package.json scripts
 * (typecheck/test/lint/build), so the check is safe, reproducible, and meaningful.
 */

export interface VerifyResult {
  passed: boolean;
  command: string;
  output: string;
  skipped?: boolean;
}

const OUTPUT_CAP = 4_000;
const DEFAULT_TIMEOUT_MS = 180_000;

/** Prefer fast, high-signal checks first; running one is enough for a tight loop. */
const SCRIPT_PRIORITY = ["typecheck", "test", "lint", "build"] as const;

function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * Pick the verify commands from the repo's package.json scripts. Returns at most
 * one command (the highest-priority script that exists) to keep the loop snappy;
 * empty array → nothing to verify (caller skips the stage gracefully).
 */
export function detectVerifyCommands(cwd: string): string[] {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return [];
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return [];
  }
  const pm = detectPackageManager(cwd);
  for (const name of SCRIPT_PRIORITY) {
    // `<pm> run <name>` is valid for npm/pnpm/yarn/bun; the bare `npm <name>` form is not.
    if (scripts[name]) return [`${pm} run ${name}`];
  }
  return [];
}

function trim(s: string, n: number): string {
  return s.length <= n ? s : `… [${s.length - n} chars trimmed]\n` + s.slice(-n);
}

/** Run one shell command, capturing merged stdout+stderr with a hard timeout. */
export function runCommand(command: string, cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<VerifyResult> {
  return new Promise((resolve) => {
    // shell:true lets Windows resolve pnpm.cmd/npm.cmd and handles the whole string.
    const child = spawn(command, { cwd, shell: true });
    let out = "";
    const cap = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > OUTPUT_CAP * 4) out = out.slice(-OUTPUT_CAP * 4);
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);

    const timer = setTimeout(() => {
      child.kill();
      resolve({ passed: false, command, output: trim(out, OUTPUT_CAP) + `\n[timed out after ${timeoutMs / 1000}s]` });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ passed: false, command, output: `failed to run: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ passed: code === 0, command, output: trim(out, OUTPUT_CAP) });
    });
  });
}

/** Run the detected verify commands in order; stop at the first failure. */
export async function runVerify(commands: string[], cwd: string): Promise<VerifyResult> {
  if (commands.length === 0) return { passed: true, command: "(none)", output: "no verify scripts detected", skipped: true };
  let last: VerifyResult = { passed: true, command: "(none)", output: "" };
  for (const cmd of commands) {
    last = await runCommand(cmd, cwd);
    if (!last.passed) return last;
  }
  return last;
}
