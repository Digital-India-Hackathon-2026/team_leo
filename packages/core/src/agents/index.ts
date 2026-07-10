import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type CreateAgentResponse,
} from "@personacode/contracts";
import { isMockMode } from "../providers/registry.js";
import { generateWithFallback } from "../agent/loop.js";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug || WINDOWS_RESERVED.test(slug)) return `agent-${randomUUID().slice(0, 8)}`;
  return slug;
}

function parseDefinition(text: string): AgentDefinition {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("model did not return an agent definition");
  return AgentDefinitionSchema.parse(JSON.parse(match[0]));
}

function mockDefinition(prompt: string): AgentDefinition {
  const words = prompt.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 4);
  const name = words.length ? words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ") : "Custom Agent";
  return AgentDefinitionSchema.parse({
    name,
    description: prompt.slice(0, 240),
    systemPrompt: `You are ${name}. Follow this mission: ${prompt}`,
    tools: [],
    skills: [],
    channels: [],
    mode: "default",
  });
}

export function agentsDir(cwd: string): string {
  return join(cwd, ".personacode", "agents");
}

export async function saveAgentDefinition(cwd: string, agent: AgentDefinition): Promise<string> {
  const dir = agentsDir(cwd);
  await mkdir(dir, { recursive: true });
  if ((await listAgentDefinitions(cwd)).some((existing) => existing.agent.name.toLowerCase() === agent.name.toLowerCase())) {
    throw new Error(`an agent named "${agent.name}" already exists`);
  }
  const base = slugify(agent.name);
  let path = join(dir, `${base}.json`);
  let suffix = 2;
  while (existsSync(path)) path = join(dir, `${base}-${suffix++}.json`);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(agent, null, 2), "utf8");
  await rename(temporary, path);
  return relative(cwd, path).replace(/\\/g, "/");
}

export async function buildAgentDefinition(opts: {
  cwd: string;
  prompt: string;
  modelRef?: string;
}): Promise<CreateAgentResponse> {
  let agent: AgentDefinition;
  if (isMockMode()) {
    agent = mockDefinition(opts.prompt);
  } else {
    const generationPrompt =
      `Create one Personacode agent definition for this request:\n${opts.prompt}\n\n` +
      `Return ONLY JSON with keys name, description, systemPrompt, optional model, tools, skills, channels, optional schedule, and mode. ` +
      `mode must be default, plan, auto, or edit. channels may only contain telegram, discord, email, slack, whatsapp, sms, googlechat, teams. ` +
      `Use empty arrays when no tools, skills, or channels are requested. Do not include markdown fences.`;
    const response = await generateWithFallback(generationPrompt, opts.modelRef);
    agent = parseDefinition(response.text);
  }
  if (agent.schedule && !cron.validate(agent.schedule)) {
    throw new Error(`invalid agent schedule: ${agent.schedule}`);
  }
  const path = await saveAgentDefinition(opts.cwd, agent);
  return { agent, path };
}

export async function listAgentDefinitions(cwd: string): Promise<Array<CreateAgentResponse>> {
  const dir = agentsDir(cwd);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const agents: Array<CreateAgentResponse> = [];
  for (const file of files) {
    try {
      const agent = AgentDefinitionSchema.parse(JSON.parse(await readFile(join(dir, basename(file)), "utf8")));
      agents.push({ agent, path: relative(cwd, join(dir, file)).replace(/\\/g, "/") });
    } catch {
      // A malformed user-owned definition should not hide valid agents.
    }
  }
  return agents;
}

export async function findAgentDefinition(cwd: string, name: string): Promise<AgentDefinition | undefined> {
  const target = name.trim().toLowerCase();
  const match = (await listAgentDefinitions(cwd)).find(({ agent }) => agent.name.toLowerCase() === target);
  return match?.agent;
}
