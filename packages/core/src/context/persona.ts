import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

/**
 * PERSONA.md is Personacode's project instruction file (our CLAUDE.md analogue).
 * We load, in priority order:
 *   1. a global one at ~/.personacode/PERSONA.md (user-wide defaults), then
 *   2. the nearest project PERSONA.md walking up from `cwd`.
 * Both are concatenated (project after global) so project rules win by recency.
 */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Walk up from `cwd` to the filesystem root looking for PERSONA.md. */
export async function findProjectPersona(cwd: string): Promise<{ path: string; content: string } | null> {
  let dir = cwd;
  const root = parse(dir).root;
  for (;;) {
    const candidate = join(dir, "PERSONA.md");
    const content = await readIfExists(candidate);
    if (content !== null) return { path: candidate, content };
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export async function loadPersona(cwd: string): Promise<string> {
  const parts: string[] = [];
  const global = await readIfExists(join(homedir(), ".personacode", "PERSONA.md"));
  if (global?.trim()) parts.push(`# Global instructions (~/.personacode/PERSONA.md)\n${global.trim()}`);
  const project = await findProjectPersona(cwd);
  if (project?.content.trim()) parts.push(`# Project instructions (PERSONA.md)\n${project.content.trim()}`);
  return parts.join("\n\n");
}
