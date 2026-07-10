import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HookConfigSchema, type HookConfig, type HookEntry } from "@personacode/contracts";

const execAsync = promisify(exec);
const MAX_HOOK_OUTPUT = 4_000;

export interface LoadedHooks {
  path: string;
  hooks: HookConfig;
  error?: string;
}

export interface HookContext {
  tool?: string;
  input?: unknown;
  result?: unknown;
}

export function hooksPath(cwd: string): string {
  return join(cwd, ".personacode", "hooks.json");
}

export async function loadHooks(cwd: string): Promise<LoadedHooks> {
  const path = hooksPath(cwd);
  if (!existsSync(path)) return { path, hooks: HookConfigSchema.parse({}) };
  try {
    const hooks = HookConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return { path, hooks };
  } catch (error) {
    return {
      path,
      hooks: HookConfigSchema.parse({}),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function matches(entry: HookEntry, tool: string): boolean {
  if (!entry.matcher || entry.matcher === "*") return true;
  return entry.matcher.split(",").some((candidate) => candidate.trim() === tool);
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

async function runEntry(cwd: string, entry: HookEntry, context: HookContext): Promise<string> {
  const input = context.input as { path?: unknown; command?: unknown } | undefined;
  const { stdout, stderr } = await execAsync(entry.command, {
    cwd,
    timeout: entry.timeoutMs ?? 30_000,
    maxBuffer: 256_000,
    windowsHide: true,
    env: {
      ...process.env,
      FILE: typeof input?.path === "string" ? input.path : "",
      PERSONACODE_TOOL: context.tool ?? "",
      PERSONACODE_TOOL_INPUT: serialize(context.input),
      PERSONACODE_TOOL_RESULT: serialize(context.result),
    },
  });
  return [stdout, stderr].filter(Boolean).join("\n").slice(-MAX_HOOK_OUTPUT);
}

export async function runToolHooks(
  cwd: string,
  phase: "preToolUse" | "postToolUse",
  context: Required<Pick<HookContext, "tool">> & HookContext,
): Promise<string[]> {
  const loaded = await loadHooks(cwd);
  if (loaded.error) throw new Error(`invalid hooks.json: ${loaded.error}`);
  const output: string[] = [];
  for (const entry of loaded.hooks[phase]) {
    if (!matches(entry, context.tool)) continue;
    const result = await runEntry(cwd, entry, context);
    if (result) output.push(result);
  }
  return output;
}

export async function runFinishHooks(cwd: string, context: HookContext = {}): Promise<string[]> {
  const loaded = await loadHooks(cwd);
  if (loaded.error) throw new Error(`invalid hooks.json: ${loaded.error}`);
  const output: string[] = [];
  for (const entry of loaded.hooks.onFinish) {
    const result = await runEntry(cwd, entry, context);
    if (result) output.push(result);
  }
  return output;
}
