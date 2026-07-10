import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Skills = Markdown files with frontmatter (name/description + instructions body).
 * Loaded from the project (`.personacode/skills/`), the user global
 * (`~/.personacode/skills/`), and any extra bundled dirs the host passes in.
 * Self-evolving: the agent can write new skill files via `saveSkill`.
 */
export interface SkillFile {
  name: string;
  description: string;
  path: string;
  body: string;
}

export function skillsDir(cwd: string): string {
  return join(cwd, ".personacode", "skills");
}

async function loadFromDir(dir: string): Promise<SkillFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: SkillFile[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
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
      /* skip unreadable */
    }
  }
  return out;
}

export async function listSkills(cwd: string, extraDirs: string[] = []): Promise<SkillFile[]> {
  const dirs = [skillsDir(cwd), join(homedir(), ".personacode", "skills"), ...extraDirs];
  const seen = new Map<string, SkillFile>();
  for (const dir of dirs) {
    for (const skill of await loadFromDir(dir)) {
      // First definition wins (project overrides global overrides bundled).
      if (!seen.has(skill.name)) seen.set(skill.name, skill);
    }
  }
  return [...seen.values()];
}

/** Compact catalog for the system prompt — names + one-line descriptions only. */
export function formatSkillCatalog(skills: SkillFile[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return `# Available skills\nThese specialized instructions are available. When a task matches one, read its file for the full instructions before acting.\n${lines}`;
}

/** Self-evolving: write a new skill markdown file into the project skills dir. */
export async function saveSkill(
  cwd: string,
  s: { name: string; description: string; body: string }
): Promise<string> {
  const dir = skillsDir(cwd);
  await mkdir(dir, { recursive: true });
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
  const file = join(dir, `${slug}.md`);
  const content = `---\nname: ${slug}\ndescription: ${s.description}\n---\n\n${s.body.trim()}\n`;
  await writeFile(file, content, "utf8");
  return file;
}
