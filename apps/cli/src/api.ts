import type { UIMessage } from "ai";
import type { AgentDefinition, LanguageCode, ModelInfo, Mode, SetupScoutResponse } from "@personacode/contracts";

/**
 * Thin client for the Personacode server. The CLI routes chat through the server
 * (rather than running the agent in-process) so it inherits PERSONA.md/memory,
 * MCP tools, checkpoints, and auto-compaction, and gets server-backed sessions.
 */
export function defaultBase(): string {
  return `http://localhost:${process.env.PERSONACODE_PORT ?? 3789}`;
}

export interface Health {
  ok: boolean;
  mock: boolean;
  workspace?: string;
}

export async function getHealth(base = defaultBase()): Promise<Health | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export async function createSession(
  base: string,
  opts: { model?: string; mode?: Mode; title?: string; language?: LanguageCode; terse?: boolean }
): Promise<string> {
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  const meta = (await res.json()) as { id: string };
  return meta.id;
}

export interface OrchestrationStage {
  stage: string;
  model: string;
  ms: number;
  detail: string;
}
export interface PermissionRequest {
  id: string;
  tool: string;
  input: unknown;
}
export interface PavStage {
  phase: "plan" | "apply" | "review" | "verify" | "done";
  detail: string;
  model?: string;
  ms?: number;
  iteration?: number;
  passed?: boolean;
  plan?: string;
  planPath?: string;
  command?: string;
  output?: string;
}
export interface ChatHandlers {
  onTextDelta: (delta: string) => void;
  onFallback?: (from: string, to: string) => void;
  onCompaction?: (info: { keptRecent?: number }) => void;
  onOrchestration?: (stage: OrchestrationStage) => void;
  onPav?: (stage: PavStage) => void;
  onPermission?: (req: PermissionRequest) => void;
  onError?: (message: string) => void;
}

/** POST /api/chat and dispatch the SSE UIMessage stream to handlers. */
export async function streamChat(
  base: string,
  body: {
    sessionId?: string;
    messages: UIMessage[];
    model?: string;
    agent?: string;
    mode?: Mode;
    language?: LanguageCode | null;
    terse?: boolean;
    disabledTools?: string[];
    orchestrate?: boolean;
    pav?: boolean;
    approvals?: boolean;
  },
  handlers: ChatHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`server responded ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line; each has a `data: <json>` field.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(json);
      } catch {
        continue;
      }
      dispatch(chunk, handlers);
    }
  }
}

function dispatch(chunk: Record<string, unknown>, h: ChatHandlers): void {
  switch (chunk.type) {
    case "text-delta":
      if (typeof chunk.delta === "string") h.onTextDelta(chunk.delta);
      break;
    case "data-fallback": {
      const d = chunk.data as { from?: string; to?: string } | undefined;
      if (d?.from && d?.to) h.onFallback?.(d.from, d.to);
      break;
    }
    case "data-compaction":
      h.onCompaction?.((chunk.data as { keptRecent?: number }) ?? {});
      break;
    case "data-orchestration":
      if (chunk.data) h.onOrchestration?.(chunk.data as OrchestrationStage);
      break;
    case "data-pav":
      if (chunk.data) h.onPav?.(chunk.data as PavStage);
      break;
    case "data-permission-request":
      if (chunk.data) h.onPermission?.(chunk.data as PermissionRequest);
      break;
    case "error":
      h.onError?.(String(chunk.errorText ?? "unknown error"));
      break;
  }
}

// ---- read-only helpers for slash commands ----
export interface McpStatus {
  servers: { name: string; connected: boolean; error?: string; tools: string[] }[];
  tools: { name: string; server: string; description: string }[];
}
export async function getMcp(base = defaultBase()): Promise<McpStatus> {
  const res = await fetch(`${base}/api/mcp`);
  return (await res.json()) as McpStatus;
}

export interface CheckpointRow {
  hash: string;
  label: string;
  time: number;
}
export async function getCheckpoints(base = defaultBase()): Promise<CheckpointRow[]> {
  const res = await fetch(`${base}/api/checkpoints`);
  return ((await res.json()) as { checkpoints: CheckpointRow[] }).checkpoints;
}
export async function respondPermission(
  base: string,
  id: string,
  decision: "allow" | "deny" | "always"
): Promise<void> {
  const res = await fetch(`${base}/api/permission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, decision }),
  });
  if (!res.ok) throw new Error(`server responded ${res.status}`);
}

export async function restoreCheckpoint(base: string, hash: string): Promise<boolean> {
  const res = await fetch(`${base}/api/checkpoints/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hash }),
  });
  return res.ok;
}

export interface NamedInfo {
  name: string;
  description: string;
}
export async function getMemory(base = defaultBase()): Promise<NamedInfo[]> {
  const res = await fetch(`${base}/api/memory`);
  return ((await res.json()) as { memories: NamedInfo[] }).memories;
}
export async function getSkills(base = defaultBase()): Promise<NamedInfo[]> {
  const res = await fetch(`${base}/api/skills`);
  return ((await res.json()) as { skills: NamedInfo[] }).skills;
}

export interface HookInfo {
  matcher?: string;
  command: string;
  timeoutMs?: number;
}
export interface HooksResponse {
  path: string;
  hooks: {
    preToolUse: HookInfo[];
    postToolUse: HookInfo[];
    onFinish: HookInfo[];
  };
  error?: string;
}
export async function getHooks(base = defaultBase()): Promise<HooksResponse> {
  const res = await fetch(`${base}/api/hooks`);
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  return (await res.json()) as HooksResponse;
}

export async function createAgent(
  base: string,
  prompt: string,
): Promise<{ agent: AgentDefinition; path: string }> {
  const res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = (await res.json()) as { agent?: AgentDefinition; path?: string; error?: string };
  if (!res.ok || !body.agent || !body.path) throw new Error(body.error ?? `server responded ${res.status}`);
  return { agent: body.agent, path: body.path };
}

export async function getAgents(base: string): Promise<Array<{ agent: AgentDefinition; path: string }>> {
  const res = await fetch(`${base}/api/agents`);
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  return (await res.json()) as Array<{ agent: AgentDefinition; path: string }>;
}

export async function deleteAgent(base: string, name: string): Promise<void> {
  const res = await fetch(`${base}/api/agents/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `server responded ${res.status}`);
  }
}

export async function getModels(base = defaultBase()): Promise<ModelInfo[]> {
  const res = await fetch(`${base}/api/models`);
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  return (await res.json()) as ModelInfo[];
}

export async function runSetupScout(base: string, apply: boolean): Promise<SetupScoutResponse> {
  const res = await fetch(`${base}/api/setup-scout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apply }),
  });
  const body = (await res.json()) as SetupScoutResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `server responded ${res.status}`);
  return body;
}

export async function getUsage(
  base: string,
  sessionId: string
): Promise<{ total: { totalTokens: number }; contextPercent: number } | null> {
  const res = await fetch(`${base}/api/sessions/${sessionId}/usage`);
  return res.ok ? ((await res.json()) as { total: { totalTokens: number }; contextPercent: number }) : null;
}
