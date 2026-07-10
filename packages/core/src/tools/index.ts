import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Mode } from "@personacode/contracts";

const execAsync = promisify(exec);

/** Token Diet: cap tool output so one noisy command can't torch the context. */
const MAX_TOOL_OUTPUT = 8_000;
function diet(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT / 2) +
    `\n… [Token Diet: ${s.length - MAX_TOOL_OUTPUT} chars trimmed] …\n` +
    s.slice(-MAX_TOOL_OUTPUT / 2)
  );
}

export interface ToolPolicy {
  mode: Mode;
  /** project root the agent operates in */
  cwd: string;
  /** names disabled via per-tool toggles */
  disabled: Set<string>;
}

/** Mode → what's allowed. Plan: read-only. Edit: files but no shell. Auto/default: all. */
function allowed(policy: ToolPolicy, toolName: string): boolean {
  if (policy.disabled.has(toolName)) return false;
  if (policy.mode === "plan") return ["read_file", "list_files", "web_fetch"].includes(toolName);
  if (policy.mode === "edit") return toolName !== "bash";
  return true;
}

function guard<T>(policy: ToolPolicy, name: string, run: () => Promise<T>): Promise<T | string> {
  if (!allowed(policy, name)) {
    return Promise.resolve(`Tool "${name}" is not allowed in ${policy.mode} mode (or is toggled off).`);
  }
  return run().catch((err: Error) => `Error in ${name}: ${err.message}`);
}

export function buildTools(policy: ToolPolicy): ToolSet {
  return {
    bash: tool({
      description:
        "Run a shell command in the project directory. Returns stdout+stderr (trimmed if huge).",
      inputSchema: z.object({ command: z.string().describe("The shell command to run") }),
      execute: ({ command }) =>
        guard(policy, "bash", async () => {
          const { stdout, stderr } = await execAsync(command, {
            cwd: policy.cwd,
            timeout: 60_000,
            windowsHide: true,
          });
          return diet([stdout, stderr].filter(Boolean).join("\n--- stderr ---\n") || "(no output)");
        }),
    }),

    read_file: tool({
      description: "Read a file (UTF-8) relative to the project directory.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) =>
        guard(policy, "read_file", async () => diet(await readFile(resolve(policy.cwd, path), "utf8"))),
    }),

    write_file: tool({
      description: "Write/overwrite a file (UTF-8), creating parent directories.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: ({ path, content }) =>
        guard(policy, "write_file", async () => {
          const full = resolve(policy.cwd, path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, content, "utf8");
          return `Wrote ${content.length} chars to ${path}`;
        }),
    }),

    list_files: tool({
      description: "List files in a directory (non-recursive) relative to the project.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: ({ path }) =>
        guard(policy, "list_files", async () => {
          const { readdir } = await import("node:fs/promises");
          const entries = await readdir(resolve(policy.cwd, path), { withFileTypes: true });
          return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)";
        }),
    }),

    web_fetch: tool({
      description: "Fetch a URL and return its text content (HTML tags stripped, trimmed).",
      inputSchema: z.object({ url: z.string().url() }),
      execute: ({ url }) =>
        guard(policy, "web_fetch", async () => {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          const text = await res.text();
          const stripped = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
          return diet(stripped);
        }),
    }),
  };
}

export type BuiltinToolName = keyof ReturnType<typeof buildTools>;
export const BUILTIN_TOOL_NAMES = ["bash", "read_file", "write_file", "list_files", "web_fetch"] as const;
