/**
 * Tiny dependency-free frontmatter parser for the Markdown-file conventions used
 * across Personacode (PERSONA.md, memory files, skills). We only need top-level
 * `key: value` scalars (name, description, …) plus the body — no full YAML.
 *
 * Supported:
 *   ---
 *   name: my-skill
 *   description: does a thing
 *   ---
 *   body text…
 */
export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): Frontmatter {
  const m = raw.match(FM_RE);
  if (!m) return { data: {}, body: raw.trim() };

  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    // Skip blanks, comments, and nested-object lines (indented / bare mapping keys).
    if (!trimmed || trimmed.startsWith("#") || line.startsWith("  ")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: (m[2] ?? "").trim() };
}
