import { loadPersona } from "./persona.js";
import { recallMemories, type MemoryFile } from "./memory.js";
import { listSkills, formatSkillCatalog, type SkillFile } from "./skills.js";

export * from "./frontmatter.js";
export * from "./persona.js";
export * from "./memory.js";
export * from "./skills.js";

export interface ProjectContext {
  /** Combined string to feed runAgentTurn's `system` option. Empty if nothing found. */
  system: string;
  persona: string;
  recalled: MemoryFile[];
  skills: SkillFile[];
}

/**
 * Assemble the per-turn project context: PERSONA.md instructions + keyword-recalled
 * memories (scored against the latest user message) + the skills catalog. The result
 * `system` string is appended to the base system prompt by the host (server/CLI).
 */
export async function buildProjectContext(opts: {
  cwd: string;
  /** latest user message, used for memory recall */
  query?: string;
  extraSkillDirs?: string[];
}): Promise<ProjectContext> {
  const [persona, recalled, skills] = await Promise.all([
    loadPersona(opts.cwd),
    opts.query ? recallMemories(opts.cwd, opts.query) : Promise.resolve([]),
    listSkills(opts.cwd, opts.extraSkillDirs ?? []),
  ]);

  const parts: string[] = [];
  if (persona) parts.push(persona);
  if (recalled.length > 0) {
    const mem = recalled
      .map((m) => `## ${m.name}${m.description ? ` — ${m.description}` : ""}\n${m.body}`)
      .join("\n\n");
    parts.push(`# Relevant memory (recalled)\nBackground from past sessions; verify before relying on specifics.\n\n${mem}`);
  }
  const catalog = formatSkillCatalog(skills);
  if (catalog) parts.push(catalog);

  return { system: parts.join("\n\n"), persona, recalled, skills };
}
