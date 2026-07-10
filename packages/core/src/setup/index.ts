import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type { SetupScoutResponse } from "@personacode/contracts";
import { buildRepoTree } from "../agent/scout.js";

const EXTENSIONS: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", java: "Java", rb: "Ruby", php: "PHP",
  cs: "C#", cpp: "C++", c: "C", swift: "Swift", kt: "Kotlin",
};

async function writeNew(path: string, content: string): Promise<boolean> {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
  return true;
}

export async function runSetupScout(cwd: string, apply = false): Promise<SetupScoutResponse> {
  const tree = await buildRepoTree(cwd);
  const files = tree.split("\n").filter(Boolean);
  const languages = [...new Set(files.map((file) => EXTENSIONS[file.split(".").pop()?.toLowerCase() ?? ""]).filter(Boolean))].sort();
  let manifest: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string } = {};
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as typeof manifest;
  } catch {
    // Non-Node repositories still receive language-based recommendations.
  }
  const dependencies = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  const frameworkChecks: Array<[string, string]> = [
    ["react", "React"], ["next", "Next.js"], ["vite", "Vite"], ["hono", "Hono"],
    ["express", "Express"], ["vue", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"],
  ];
  const frameworks = frameworkChecks.filter(([dependency]) => dependency in dependencies).map(([, name]) => name);
  const scripts = Object.keys(manifest.scripts ?? {}).sort();
  const packageManager = manifest.packageManager?.split("@")[0] ??
    (files.includes("pnpm-lock.yaml") ? "pnpm" : files.includes("yarn.lock") ? "yarn" : files.includes("package-lock.json") ? "npm" : undefined);
  const verifyCommands = ["typecheck", "test", "lint", "build"].filter((name) => scripts.includes(name));
  const runScript = (command: string) => `${packageManager}${packageManager === "npm" ? " run" : ""} ${command}`;
  const personaTemplate =
    `# Project Instructions\n\n` +
    `## Stack\n${languages.length ? languages.map((language) => `- ${language}`).join("\n") : "- Add the primary language"}\n` +
    (frameworks.length ? `${frameworks.map((framework) => `- ${framework}`).join("\n")}\n` : "") +
    `\n## Commands\n` +
    (verifyCommands.length && packageManager
      ? verifyCommands.map((command) => `- \`${runScript(command)}\``).join("\n")
      : "- Add build, test, and typecheck commands") +
    `\n\n## Rules\n- Make the smallest correct change.\n- Preserve existing conventions.\n- Run the relevant verification before finishing.\n`;
  const skillContent =
    `---\nname: project-verification\ndescription: Run this project's checks before completing code changes\n---\n` +
    (verifyCommands.length && packageManager
      ? `Run these commands and fix failures: ${verifyCommands.map(runScript).join(", ")}.\n`
      : "Identify and run the repository's build, test, lint, and typecheck commands.\n");
  const response: SetupScoutResponse = {
    detected: { languages, frameworks, packageManager, scripts },
    recommendations: {
      mcpServers: [{
        name: "filesystem",
        description: "Official MCP filesystem server scoped to this workspace",
        config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
      }],
      skills: [{ name: "project-verification", description: "Project-specific verification workflow", content: skillContent }],
      personaTemplate,
    },
    applied: [],
  };
  if (!apply) return response;

  const personaPath = join(cwd, "PERSONA.md");
  if (await writeNew(personaPath, personaTemplate)) response.applied.push(relative(cwd, personaPath).replace(/\\/g, "/"));
  const skillPath = join(cwd, ".personacode", "skills", "project-verification.md");
  if (await writeNew(skillPath, skillContent)) response.applied.push(relative(cwd, skillPath).replace(/\\/g, "/"));
  const mcpPath = join(cwd, ".personacode", "mcp.json");
  if (await writeNew(mcpPath, JSON.stringify({ mcpServers: { filesystem: response.recommendations.mcpServers[0]?.config } }, null, 2))) {
    response.applied.push(relative(cwd, mcpPath).replace(/\\/g, "/"));
  }
  return response;
}
