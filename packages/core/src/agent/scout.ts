import { generateText } from "ai";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { getModel, isMockMode } from "../providers/registry.js";
import { modelForRole, nextParallelRef } from "../providers/roles.js";

/**
 * Model Crew — Context Scout pipeline. A fast "scout" model picks the ≤12 files most
 * relevant to the task from a cheap local repo tree; fast "summarizer" models brief
 * them in parallel, round-robined across providers (multiplying free-tier limits);
 * the brief is injected so the strong "brain" model starts with context already known
 * and spends far fewer slow tool round-trips. Strictly additive: any failure returns
 * null / partial and the normal single-model turn proceeds.
 */
export interface OrchestrationStage {
  stage: "scout" | "brief" | "review";
  model: string;
  ms: number;
  detail: string;
}
export interface ScoutResult {
  brief: string;
  files: string[];
  stages: OrchestrationStage[];
}

const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage", ".personacode", ".next", ".cache"]);
const MAX_ENTRIES = 400;
const MAX_FILES = 12;
const BRIEF_TRIM = 2_000; // files at/under this go in verbatim; larger get summarized

function trim(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + `\n… [${s.length - n} chars trimmed]`;
}

/** Heuristic: is this a code task worth orchestrating? */
export async function isCodeTask(task: string, cwd: string): Promise<boolean> {
  if (/\b(file|code|function|class|bug|fix|implement|refactor|test|error|build|import|path)\b/i.test(task)) return true;
  if (/[\\/][\w.-]+\.\w+/.test(task) || /\.\w{2,4}\b/.test(task)) return true;
  try {
    const entries = await readdir(cwd);
    return entries.includes("package.json") || entries.includes("src") || entries.includes("Cargo.toml") || entries.includes("go.mod");
  } catch {
    return false;
  }
}

/** Full relative file paths (one per line, zero LLM cost), capped at MAX_ENTRIES. */
export async function buildRepoTree(cwd: string): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= MAX_ENTRIES || depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_ENTRIES) return;
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1);
      else files.push(relative(cwd, join(dir, e.name)).replace(/\\/g, "/"));
    }
  }
  await walk(cwd, 0);
  return files.join("\n");
}

async function gen(prompt: string, ref: string): Promise<string> {
  const { text } = await generateText({ model: getModel(ref), prompt });
  return text;
}

/** ONE scout call → up to MAX_FILES relevant paths. Parses defensively (regex). */
export async function pickFiles(task: string, tree: string): Promise<{ paths: string[]; stage: OrchestrationStage }> {
  const ref = modelForRole("scout");
  const started = Date.now();
  const prompt =
    `Task: ${task}\n\nRepository tree:\n${tree}\n\n` +
    `Return ONLY a JSON array of up to ${MAX_FILES} file paths from the tree that are most relevant ` +
    `to the task. No prose, just the array, e.g. ["src/a.ts","src/b.ts"].`;
  let paths: string[] = [];
  try {
    const text = await gen(prompt, ref);
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown;
      if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === "string").slice(0, MAX_FILES);
    }
  } catch {
    paths = [];
  }
  return {
    paths,
    stage: { stage: "scout", model: ref, ms: Date.now() - started, detail: `picked ${paths.length} files` },
  };
}

/** Read + summarize the picked files in parallel across providers. */
export async function briefFiles(paths: string[], cwd: string): Promise<{ brief: string; stage: OrchestrationStage }> {
  const started = Date.now();
  const models = new Set<string>();
  const parts = await Promise.all(
    paths.map(async (p) => {
      let content: string;
      try {
        content = await readFile(join(cwd, p), "utf8");
      } catch {
        return `## ${p}\n(could not read)`;
      }
      if (content.length <= BRIEF_TRIM) return `## ${p}\n${content}`;
      const ref = nextParallelRef("summarizer");
      models.add(ref);
      try {
        const summary = await gen(
          `Summarize this file's purpose, key exports, and anything relevant to a coding task. Be terse.\n\nFILE ${p}:\n${trim(content, 6000)}`,
          ref
        );
        return `## ${p}\n${summary.trim()}`;
      } catch {
        return `## ${p}\n${trim(content, BRIEF_TRIM)}`;
      }
    })
  );
  return {
    brief: parts.join("\n\n"),
    stage: {
      stage: "brief",
      model: models.size ? [...models].join(", ") : "verbatim",
      ms: Date.now() - started,
      detail: `briefed ${paths.length} files${models.size ? ` across ${models.size} provider(s)` : ""}`,
    },
  };
}

/** Full pipeline. Returns null to signal "skip — run the normal turn". */
export async function runScout(opts: { cwd: string; task: string; force?: boolean }): Promise<ScoutResult | null> {
  if (!opts.force && !(await isCodeTask(opts.task, opts.cwd))) return null;

  if (isMockMode()) {
    // Simulated stages so the UI/demo works with `pnpm dev:mock` (no keys).
    return {
      brief: "CONTEXT BRIEF (mock): scanned repo tree, picked example files.",
      files: ["src/index.ts", "src/agent/loop.ts"],
      stages: [
        { stage: "scout", model: "mock/mock-1", ms: 180, detail: "picked 2 files" },
        { stage: "brief", model: "mock/mock-1", ms: 240, detail: "briefed 2 files across 2 provider(s)" },
      ],
    };
  }

  const tree = await buildRepoTree(opts.cwd);
  const { paths, stage: scoutStage } = await pickFiles(opts.task, tree);
  if (paths.length === 0) return { brief: "", files: [], stages: [scoutStage] };
  const { brief, stage: briefStage } = await briefFiles(paths, opts.cwd);
  return { brief, files: paths, stages: [scoutStage, briefStage] };
}
