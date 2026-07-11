import { readFile } from "node:fs/promises";
import { isMockMode } from "../providers/registry.js";
import { resolveWorkspacePath } from "../security/paths.js";
import { LspClient, type LspDiagnostic } from "./client.js";
import { installHintFor, languageIdFor, resolveServer, serverGroupFor } from "./servers.js";

export { LspClient } from "./client.js";
export type { LspDiagnostic } from "./client.js";
export { languageIdFor, onPath, resolveServer } from "./servers.js";

export interface LspReport {
  diagnostics: LspDiagnostic[];
  errorCount: number;
  warningCount: number;
  /** groups we actually ran a server for. */
  ran: string[];
  /** languages we could not check because no server is installed. */
  missing: Array<{ group: string; files: string[]; hint: string }>;
  /** agent- and human-readable rendering (errors first, grouped by file). */
  text: string;
}

interface OpenFile {
  absPath: string;
  relPath: string;
  languageId: string;
  text: string;
}

const SEVERITY_RANK: Record<LspDiagnostic["severity"], number> = { error: 0, warning: 1, info: 2, hint: 3 };

/**
 * Collect language-server diagnostics for the given files (paths relative to `cwd`).
 * Groups files by language server, runs each installed server once, and merges the
 * results. Entirely fail-soft: missing servers, unreadable files, or a crashing server
 * degrade to notes in the report — this never throws. In mock mode it returns a
 * deterministic sample so the pipeline demos with `pnpm dev:mock`.
 */
export async function getDiagnostics(cwd: string, paths: string[]): Promise<LspReport> {
  const unique = [...new Set(paths.map((p) => p.replace(/\\/g, "/")))].filter(Boolean);

  if (isMockMode()) {
    const sample = unique[0] ?? "src/example.ts";
    const diagnostics: LspDiagnostic[] = [
      { file: sample, line: 12, col: 5, severity: "error", message: "Type 'string' is not assignable to type 'number'.", source: "ts", code: 2322 },
      { file: sample, line: 20, col: 9, severity: "warning", message: "'value' is declared but its value is never read.", source: "ts", code: 6133 },
    ];
    return finalize(diagnostics, ["typescript"], []);
  }

  // Group readable files by their server group.
  const byGroup = new Map<string, OpenFile[]>();
  const missing = new Map<string, { files: string[]; hint: string }>();
  const notes: string[] = [];

  for (const rel of unique) {
    const languageId = languageIdFor(rel);
    if (!languageId) {
      notes.push(`- ${rel}: unsupported file type for diagnostics (skipped).`);
      continue;
    }
    const group = serverGroupFor(languageId);
    if (!group) {
      notes.push(`- ${rel}: no diagnostics provider for ${languageId} (skipped).`);
      continue;
    }
    let absPath: string;
    let text: string;
    try {
      absPath = await resolveWorkspacePath(cwd, rel);
      text = await readFile(absPath, "utf8");
    } catch {
      notes.push(`- ${rel}: could not be read (skipped).`);
      continue;
    }
    const server = resolveServer(group);
    if (!server) {
      const entry = missing.get(group) ?? { files: [], hint: installHintFor(group) ?? "install a language server" };
      entry.files.push(rel);
      missing.set(group, entry);
      continue;
    }
    (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push({ absPath, relPath: rel, languageId, text });
  }

  const diagnostics: LspDiagnostic[] = [];
  const ran: string[] = [];
  for (const [group, files] of byGroup) {
    const server = resolveServer(group)!;
    try {
      const client = new LspClient(server.command, server.args, cwd);
      try {
        await client.initialize(cwd);
        diagnostics.push(...(await client.openAndCollect(files)));
        ran.push(group);
      } finally {
        await client.dispose();
      }
    } catch {
      notes.push(`- ${group}: language server (${server.command}) failed to run (skipped).`);
    }
  }

  const report = finalize(
    diagnostics,
    ran,
    [...missing].map(([group, v]) => ({ group, files: v.files, hint: v.hint })),
  );
  return notes.length ? { ...report, text: `${report.text}\n\n${notes.join("\n")}`.trim() } : report;
}

function finalize(
  diagnostics: LspDiagnostic[],
  ran: string[],
  missing: LspReport["missing"],
): LspReport {
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  return { diagnostics, errorCount, warningCount, ran, missing, text: formatDiagnostics(diagnostics, missing) };
}

/** Render diagnostics for the model/human: grouped by file, errors first. */
export function formatDiagnostics(diagnostics: LspDiagnostic[], missing: LspReport["missing"] = []): string {
  const lines: string[] = [];

  if (diagnostics.length === 0 && missing.length === 0) {
    lines.push("No problems reported by the language server. ✓");
  }

  const byFile = new Map<string, LspDiagnostic[]>();
  for (const d of diagnostics) (byFile.get(d.file) ?? byFile.set(d.file, []).get(d.file)!).push(d);

  for (const [file, items] of byFile) {
    lines.push(file);
    items
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line || a.col - b.col)
      .forEach((d) => {
        const code = d.code !== undefined ? ` (${d.source ? `${d.source} ` : ""}${d.code})` : d.source ? ` (${d.source})` : "";
        lines.push(`  ${d.line}:${d.col}  ${d.severity}  ${d.message}${code}`);
      });
  }

  if (missing.length) {
    lines.push("");
    for (const m of missing) {
      lines.push(`No language server installed for: ${m.files.join(", ")}`);
      lines.push(`  → install one to enable diagnostics: ${m.hint}`);
    }
  }

  return lines.join("\n");
}
