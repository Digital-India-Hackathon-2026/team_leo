import type { UIMessage } from "ai";
import type { Mode } from "@personacode/contracts";

/**
 * Thin client for the Personacode server. The CLI routes chat through the server
 * (rather than running the agent in-process) so it inherits PERSONA.md/memory,
 * MCP tools, checkpoints, and auto-compaction, and gets server-backed sessions.
 */
export const DEFAULT_BASE = `http://localhost:${process.env.PERSONACODE_PORT ?? 3789}`;

export interface Health {
  ok: boolean;
  mock: boolean;
}

export async function getHealth(base = DEFAULT_BASE): Promise<Health | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export async function createSession(
  base: string,
  opts: { model?: string; mode?: Mode; title?: string }
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
export interface ChatHandlers {
  onTextDelta: (delta: string) => void;
  onFallback?: (from: string, to: string) => void;
  onCompaction?: (info: { keptRecent?: number }) => void;
  onOrchestration?: (stage: OrchestrationStage) => void;
  onError?: (message: string) => void;
}

/** POST /api/chat and dispatch the SSE UIMessage stream to handlers. */
export async function streamChat(
  base: string,
  body: {
    sessionId?: string;
    messages: UIMessage[];
    model?: string;
    mode?: Mode;
    disabledTools?: string[];
    orchestrate?: boolean;
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
export async function getMcp(base = DEFAULT_BASE): Promise<McpStatus> {
  const res = await fetch(`${base}/api/mcp`);
  return (await res.json()) as McpStatus;
}

export interface CheckpointRow {
  hash: string;
  label: string;
  time: number;
}
export async function getCheckpoints(base = DEFAULT_BASE): Promise<CheckpointRow[]> {
  const res = await fetch(`${base}/api/checkpoints`);
  return ((await res.json()) as { checkpoints: CheckpointRow[] }).checkpoints;
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
export async function getMemory(base = DEFAULT_BASE): Promise<NamedInfo[]> {
  const res = await fetch(`${base}/api/memory`);
  return ((await res.json()) as { memories: NamedInfo[] }).memories;
}
export async function getSkills(base = DEFAULT_BASE): Promise<NamedInfo[]> {
  const res = await fetch(`${base}/api/skills`);
  return ((await res.json()) as { skills: NamedInfo[] }).skills;
}

export async function getUsage(
  base: string,
  sessionId: string
): Promise<{ total: { totalTokens: number }; contextPercent: number } | null> {
  const res = await fetch(`${base}/api/sessions/${sessionId}/usage`);
  return res.ok ? ((await res.json()) as { total: { totalTokens: number }; contextPercent: number }) : null;
}
