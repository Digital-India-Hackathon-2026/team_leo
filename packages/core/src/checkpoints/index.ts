import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Checkpoints = a *shadow* git repository under `.personacode/checkpoints/shadow.git`
 * whose work-tree is the project itself. Because it uses a separate --git-dir, it
 * never touches (or requires) the user's real `.git`. Each checkpoint is one commit;
 * `/rewind` restores the tracked files to a chosen checkpoint. This is the same idea
 * Claude Code's checkpoints use, built on plain git so there are no native deps.
 */
export interface Checkpoint {
  hash: string;
  label: string;
  /** unix seconds */
  time: number;
}

// Kept out of snapshots so `add -A` stays fast and the shadow repo doesn't recurse
// into itself, node_modules, build output, etc.
const EXCLUDES = [
  ".git",
  ".personacode",
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".pnpm",
  ".next",
  ".cache",
];

const IDENT = ["-c", "user.name=Personacode", "-c", "user.email=checkpoints@personacode.local"];

export class CheckpointStore {
  private gitDir: string;
  constructor(private cwd: string) {
    this.gitDir = join(cwd, ".personacode", "checkpoints", "shadow.git");
  }

  private base(): string[] {
    return [`--git-dir=${this.gitDir}`, `--work-tree=${this.cwd}`];
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.cwd,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
  }

  /** Create the shadow repo + exclude file if it doesn't exist yet. Idempotent. */
  async init(): Promise<void> {
    if (existsSync(this.gitDir)) return;
    await mkdir(this.gitDir, { recursive: true });
    await this.git([...this.base(), "init", "-q"]);
    await this.git([...this.base(), "config", "core.autocrlf", "false"]);
    await writeFile(join(this.gitDir, "info", "exclude"), EXCLUDES.join("\n") + "\n", "utf8");
  }

  /** Snapshot the current working tree as a checkpoint. Returns its commit hash. */
  async snapshot(label: string): Promise<Checkpoint> {
    await this.init();
    await this.git([...this.base(), "add", "-A"]);
    await this.git([...this.base(), ...IDENT, "commit", "-q", "--allow-empty", "-m", label]);
    const hash = await this.git([...this.base(), "rev-parse", "HEAD"]);
    const time = Number(await this.git([...this.base(), "log", "-1", "--pretty=format:%ct"]));
    return { hash, label, time };
  }

  /** List checkpoints, newest first. Empty if no shadow repo yet. */
  async list(): Promise<Checkpoint[]> {
    if (!existsSync(this.gitDir)) return [];
    let out: string;
    try {
      out = await this.git([...this.base(), "log", "--pretty=format:%H%x1f%ct%x1f%s"]);
    } catch {
      return []; // no commits yet
    }
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [hash, ct, label] = line.split("\x1f");
      return { hash, time: Number(ct), label: label ?? "" };
    });
  }

  /**
   * Restore the working tree to exactly match the given checkpoint: reverted tracked
   * files AND removal of files created after the checkpoint. `clean -fd` honours the
   * info/exclude list, so node_modules / dist / .git are never touched.
   */
  async restore(hash: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/i.test(hash)) throw new Error("invalid checkpoint hash");
    const checkpoints = await this.list();
    if (!checkpoints.some((checkpoint) => checkpoint.hash === hash)) throw new Error("unknown checkpoint");
    await this.git([...this.base(), ...IDENT, "reset", "--hard", hash]);
    await this.git([...this.base(), "clean", "-fd"]);
  }
}
