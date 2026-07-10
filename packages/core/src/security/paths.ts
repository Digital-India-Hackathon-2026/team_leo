import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const PROTECTED_SEGMENTS = new Set([".git", ".personacode"]);

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function protectedPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/").filter(Boolean);
  const base = parts.at(-1) ?? "";
  return (
    parts.some((part) => PROTECTED_SEGMENTS.has(part)) ||
    (/^\.env(?:\.|$)/.test(base) && base !== ".env.example") ||
    normalized === "docs/api.md"
  );
}

/** Resolve a user/model path while preventing traversal, secret access, and symlink escapes. */
export async function resolveWorkspacePath(
  cwd: string,
  input: string,
  opts: { write?: boolean; allowRoot?: boolean } = {},
): Promise<string> {
  if (!input || input.includes("\0") || isAbsolute(input)) throw new Error("path must be workspace-relative");
  const root = await realpath(cwd);
  const full = resolve(root, input);
  if (!inside(root, full)) throw new Error("path is outside the workspace");
  const rel = relative(root, full);
  if (!opts.allowRoot && !rel) throw new Error("path must name a file or directory");
  if (protectedPath(rel)) throw new Error("path is protected");

  let existing = full;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = await realpath(existing);
  if (!inside(root, realExisting)) throw new Error("path escapes the workspace through a link");
  if (protectedPath(relative(root, realExisting))) throw new Error("path resolves to a protected location");
  if (!opts.write && existsSync(full)) {
    const realTarget = await realpath(full);
    if (!inside(root, realTarget)) throw new Error("path escapes the workspace through a link");
    if (protectedPath(relative(root, realTarget))) throw new Error("path resolves to a protected location");
    return realTarget;
  }
  return full;
}
