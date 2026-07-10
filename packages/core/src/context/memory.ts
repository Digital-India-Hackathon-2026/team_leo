import { readFile, readdir, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Memory = Markdown files with frontmatter under `.personacode/memory/`, plus a
 * `MEMORY.md` index (the same human-readable pattern Claude Code / this repo uses).
 * Day-1 recall is embedding-free keyword overlap (embeddings are a stretch goal).
 */
export interface MemoryFile {
  name: string;
  description: string;
  path: string;
  body: string;
}

const STOP = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "have", "how",
  "what", "when", "was", "are", "not", "but", "can", "from", "into", "get",
]);

export function memoryDir(cwd: string): string {
  return join(cwd, ".personacode", "memory");
}

export async function listMemories(cwd: string): Promise<MemoryFile[]> {
  const dir = memoryDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: MemoryFile[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md") || file === "MEMORY.md") continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const { data, body } = parseFrontmatter(raw);
      out.push({
        name: data.name ?? file.replace(/\.md$/, ""),
        description: data.description ?? "",
        path: join(dir, file),
        body,
      });
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Score each memory by keyword overlap with `query`; return top matches (score>0). */
export async function recallMemories(cwd: string, query: string, limit = 4): Promise<MemoryFile[]> {
  const memories = await listMemories(cwd);
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];
  const scored = memories
    .map((mem) => {
      const hay = new Set(tokenize(`${mem.name} ${mem.description} ${mem.body}`));
      let score = 0;
      for (const t of qTokens) if (hay.has(t)) score++;
      return { mem, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.mem);
}

/** Persist a new memory file and append a one-line pointer to MEMORY.md. */
export async function writeMemory(
  cwd: string,
  m: { name: string; description: string; type?: string; body: string }
): Promise<string> {
  const dir = memoryDir(cwd);
  await mkdir(dir, { recursive: true });
  const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "memory";
  const file = join(dir, `${slug}.md`);
  const content =
    `---\nname: ${slug}\ndescription: ${m.description}\nmetadata:\n  type: ${m.type ?? "project"}\n---\n\n${m.body.trim()}\n`;
  await writeFile(file, content, "utf8");

  const index = join(dir, "MEMORY.md");
  const line = `- [${m.name}](${slug}.md) — ${m.description}\n`;
  try {
    await appendFile(index, line, "utf8");
  } catch {
    await writeFile(index, `# Memory index\n\n${line}`, "utf8");
  }
  return file;
}
