import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createUIMessageStreamResponse } from "ai";
import type { UIMessage } from "ai";
import {
  ChatRequestSchema,
  CompareRequestSchema,
  CreateAgentRequestSchema,
  CreateNoteRequestSchema,
  CreateSessionRequestSchema,
  CreateTaskRequestSchema,
  PermissionDecisionSchema,
  SetupScoutRequestSchema,
  UpdateNoteRequestSchema,
  UpdateTaskRequestSchema,
} from "@personacode/contracts";
import type { AgentDefinition, ChannelAdapter, ChannelMessage, Mode, TokenUsage } from "@personacode/contracts";
import {
  ChannelSessionStore,
  BUILTIN_TOOL_NAMES,
  SessionStore,
  NotesTasksStore,
  CheckpointStore,
  buildProjectContext,
  buildAgentDefinition,
  compareModels,
  contextWindowFor,
  defaultModelRef,
  findAgentDefinition,
  getMcpManager,
  isMockMode,
  listMemories,
  listAgentDefinitions,
  listModels,
  listProviders,
  listSkills,
  loadHooks,
  runAgentTurn,
  runPavLoop,
  runSetupScout,
  resolveWorkspacePath,
} from "@personacode/core";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { readdir, readFile as fsReadFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

// Load .env from the nearest ancestor that has one, so keys are found whether the
// server is launched from the repo root or from apps/server (pnpm sets cwd to the
// package dir, where dotenv's default cwd lookup would miss the root .env).
(function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig({ quiet: true }); // fall back to default behavior if no .env found
})();

const configuredSecrets = Object.entries(process.env)
  .filter(([name, value]) => /(?:key|token|secret|password)/i.test(name) && typeof value === "string" && value.length >= 8)
  .map(([, value]) => value as string);

function redactText(value: string): string {
  let redacted = value;
  for (const secret of configuredSecrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/AIza[\w-]{20,}/g, "[REDACTED]")
    .replace(/(?:sk|ghp|github_pat|gsk|xox[baprs])[-_][A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]");
}

function redactValue<T>(value: T): T {
  return JSON.parse(redactText(JSON.stringify(value))) as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const app = new Hono();
const shared = new Map<string, string>(); // shareId → frozen session JSON

// Pending tool-approval requests: id → resolver. A turn's tool awaits here until the
// client POSTs a decision to /api/permission (or the request times out → deny).
const pendingApprovals = new Map<string, (d: "allow" | "deny" | "always") => void>();
const APPROVAL_TIMEOUT_MS = 120_000;
function waitForDecision(id: string): Promise<"allow" | "deny" | "always"> {
  return new Promise((resolve) => {
    const done = (d: "allow" | "deny" | "always") => {
      clearTimeout(timer);
      pendingApprovals.delete(id);
      resolve(d);
    };
    const timer = setTimeout(() => done("deny"), APPROVAL_TIMEOUT_MS);
    pendingApprovals.set(id, done);
  });
}

app.use(
  "/api/*",
  cors({
    origin: (origin) => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ""),
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, mock: isMockMode() }));
app.get("/api/providers", (c) => c.json(listProviders()));
app.get("/api/models", (c) => c.json(listModels()));

// MCP server status + tool inventory (from .personacode/mcp.json in the workspace).
app.get("/api/mcp", async (c) => {
  const mcp = getMcpManager();
  await mcp.ensureConnected(WS_ROOT);
  return c.json({
    servers: mcp.status(),
    tools: mcp.listTools().map((t) => ({ name: t.qualifiedName, server: t.server, description: t.description })),
  });
});

// ---- workspace files (powers the Files tab) ----
// The project the agent works on. pnpm runs the server with cwd=apps/server, so
// default to the repo root (nearest ancestor with pnpm-workspace.yaml or .git).
// Override with PERSONACODE_WORKSPACE to point at any project directory.
function findWorkspaceRoot(): string {
  if (process.env.PERSONACODE_WORKSPACE) return resolve(process.env.PERSONACODE_WORKSPACE);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const WS_ROOT = findWorkspaceRoot();
const store = new SessionStore(WS_ROOT);
const dataStore = new NotesTasksStore(WS_ROOT);
const channelSessions = new ChannelSessionStore(WS_ROOT);
const checkpoints = new CheckpointStore(WS_ROOT);
const WS_IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".turbo", "coverage", ".personacode", ".pnpm",
  ".claude", ".playwright-mcp", ".understand-anything", ".vscode", ".idea",
]);
function isSecretPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/");
  const base = parts.at(-1) ?? "";
  return (
    parts.includes(".git") ||
    parts.includes(".personacode") ||
    normalized === "docs/api.md" ||
    (/^\.env(\.|$)/.test(base) && base !== ".env.example")
  );
}

app.get("/api/files", async (c) => {
  type Node = { name: string; path: string; type: "dir" | "file"; size?: number; children?: Node[] };
  async function walk(dir: string, rel: string, depth: number): Promise<Node[]> {
    if (depth > 6) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs: Node[] = [];
    const files: Node[] = [];
    for (const e of entries) {
      if (WS_IGNORE.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (isSecretPath(relPath)) continue;
      if (e.isDirectory()) {
        dirs.push({ name: e.name, path: relPath, type: "dir", children: await walk(join(dir, e.name), relPath, depth + 1) });
      } else {
        let size: number | undefined;
        try {
          size = (await stat(join(dir, e.name))).size;
        } catch {
          /* ignore */
        }
        files.push({ name: e.name, path: relPath, type: "file", size });
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  }
  return c.json({ root: WS_ROOT.split(/[\\/]/).pop() ?? "workspace", tree: await walk(WS_ROOT, "", 0) });
});

app.get("/api/file", async (c) => {
  const rel = c.req.query("path") ?? "";
  try {
    const full = await resolveWorkspacePath(WS_ROOT, rel);
    const content = await fsReadFile(full, "utf8");
    return c.json({ path: rel, content: content.slice(0, 200_000), truncated: content.length > 200_000 });
  } catch (error) {
    if (error instanceof Error && /workspace|protected|relative|link/.test(error.message)) {
      return c.json({ error: "not readable" }, 403);
    }
    return c.json({ error: "not found or not text" }, 404);
  }
});

// ---- memory + skills (project context inventory) ----
app.get("/api/memory", async (c) => {
  const memories = await listMemories(WS_ROOT);
  return c.json({ memories: memories.map((m) => ({ name: m.name, description: m.description })) });
});
app.get("/api/skills", async (c) => {
  const skills = await listSkills(WS_ROOT);
  return c.json({ skills: skills.map((s) => ({ name: s.name, description: s.description })) });
});
app.get("/api/hooks", async (c) => c.json(await loadHooks(WS_ROOT)));

app.get("/api/setup-scout", async (c) => c.json(await runSetupScout(WS_ROOT, false)));
app.post("/api/setup-scout", async (c) => {
  const parsed = SetupScoutRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, 400);
  return c.json(await runSetupScout(WS_ROOT, parsed.data.apply));
});

app.get("/api/agents", async (c) => c.json(await listAgentDefinitions(WS_ROOT)));
app.post("/api/agents", async (c) => {
  const parsed = CreateAgentRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid agent prompt" }, 400);
  try {
    const result = await buildAgentDefinition({ cwd: WS_ROOT, prompt: parsed.data.prompt, modelRef: parsed.data.model });
    await registerScheduledAgent(result.agent);
    return c.json(result, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

// ---- notes + tasks (workspace-local persistent JSON) ----
app.get("/api/notes", (c) => c.json(dataStore.listNotes()));
app.post("/api/notes", async (c) => {
  const parsed = CreateNoteRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid note" }, 400);
  return c.json(dataStore.createNote(parsed.data), 201);
});
const updateNote = async (c: Context) => {
  const parsed = UpdateNoteRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid note" }, 400);
  const note = dataStore.updateNote(c.req.param("id") ?? "", parsed.data);
  return note ? c.json(note) : c.json({ error: "not found" }, 404);
};
app.put("/api/notes/:id", updateNote);
app.patch("/api/notes/:id", updateNote);
app.delete("/api/notes/:id", (c) =>
  dataStore.deleteNote(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404),
);

app.get("/api/tasks", (c) => c.json(dataStore.listTasks()));
app.post("/api/tasks", async (c) => {
  const parsed = CreateTaskRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid task" }, 400);
  return c.json(dataStore.createTask(parsed.data), 201);
});
app.patch("/api/tasks/:id", async (c) => {
  const parsed = UpdateTaskRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid task" }, 400);
  const task = dataStore.updateTask(c.req.param("id"), parsed.data);
  return task ? c.json(task) : c.json({ error: "not found" }, 404);
});
app.delete("/api/tasks/:id", (c) =>
  dataStore.deleteTask(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404),
);

app.get("/api/cookbook", async (c) => {
  const { getCookbookRecommendations } = await import("@personacode/channels");
  return c.json(await getCookbookRecommendations());
});

// ---- checkpoints (shadow-git rewind) ----
app.get("/api/checkpoints", async (c) => c.json({ checkpoints: await checkpoints.list() }));
app.post("/api/checkpoints/restore", async (c) => {
  const { hash } = (await c.req.json().catch(() => ({}))) as { hash?: string };
  if (!hash) return c.json({ error: "hash required" }, 400);
  if (!/^[a-f0-9]{40}$/i.test(hash)) return c.json({ error: "invalid checkpoint hash" }, 400);
  try {
    await checkpoints.restore(hash);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---- sessions ----
app.get("/api/sessions", (c) => c.json(store.list()));
app.post("/api/sessions", async (c) => {
  const body = CreateSessionRequestSchema.parse(await c.req.json().catch(() => ({})));
  const session = store.create({
    title: body.title,
    model: body.model ?? defaultModelRef(),
    mode: body.mode,
  });
  const { messages: _m, ...meta } = session;
  return c.json(meta);
});
app.get("/api/sessions/:id", (c) => {
  const s = store.get(c.req.param("id"));
  return s ? c.json(s) : c.json({ error: "not found" }, 404);
});
app.delete("/api/sessions/:id", (c) => {
  store.delete(c.req.param("id"));
  return c.json({ ok: true });
});
app.get("/api/sessions/:id/usage", (c) => {
  const s = store.get(c.req.param("id"));
  if (!s) return c.json({ error: "not found" }, 404);
  return c.json({
    sessionId: s.id,
    total: s.usage,
    contextPercent: Math.min(1, s.usage.totalTokens / contextWindowFor(s.model)),
    byProvider: { [s.model.split("/")[0]]: s.usage },
  });
});

// ---- chat (AI SDK v7 UIMessage stream, useChat-compatible) ----
app.post("/api/chat", async (c) => {
  const body = ChatRequestSchema.parse(await c.req.json());
  const messages = body.messages as UIMessage[];
  const session = body.sessionId ? store.get(body.sessionId) : undefined;
  const agentDefinition = body.agent ? await findAgentDefinition(WS_ROOT, body.agent) : undefined;
  if (body.agent && !agentDefinition) return c.json({ error: "agent not found" }, 404);
  const modelRef = body.model ?? agentDefinition?.model ?? session?.model ?? defaultModelRef();
  const mode = body.mode ?? agentDefinition?.mode ?? session?.mode ?? "default";
  const disabledTools = new Set(body.disabledTools ?? []);
  if (agentDefinition?.tools.length) {
    for (const name of BUILTIN_TOOL_NAMES) if (!agentDefinition.tools.includes(name)) disabledTools.add(name);
  }

  // Assemble project context (PERSONA.md + recalled memory + skills catalog),
  // scored against the latest user message, and inject it as extra system text.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const query = (lastUser?.parts ?? [])
    .map((p) => ((p as { type: string; text?: string }).type === "text" ? (p as { text?: string }).text ?? "" : ""))
    .join(" ");
  const ctx = await buildProjectContext({ cwd: WS_ROOT, query });

  // Auto-checkpoint before any turn that can modify files, so the user can /rewind.
  // PAV always edits (even when launched from plan mode), so checkpoint for it too.
  // Fail-soft: a checkpoint error must never block the chat.
  if (mode !== "plan" || body.pav) {
    await checkpoints
      .snapshot(`before: ${redactText(query).slice(0, 60) || "turn"}`)
      .catch((err) => console.warn(`[checkpoint] skipped: ${redactText(err instanceof Error ? err.message : String(err))}`));
  }

  // Connect configured MCP servers (memoized) and expose their tools this turn.
  const mcp = getMcpManager();
  await mcp.ensureConnected(WS_ROOT);
  if (agentDefinition?.tools.length) {
    for (const info of mcp.listTools()) {
      if (!agentDefinition.tools.includes(info.qualifiedName)) disabledTools.add(info.qualifiedName);
    }
  }
  const extraTools = mcp.buildToolSet({ mode: body.pav ? "plan" : mode, disabled: disabledTools });
  const turnSystem = await systemForAgent(ctx.system, agentDefinition);

  // Persist the assistant reply + usage into the session (shared by both turn kinds).
  const onFinishTurn = ({ text, usage, modelRef: usedRef }: { text: string; usage: TokenUsage; modelRef: string }) => {
    if (!session) return;
    session.messages = [
      ...messages,
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] },
    ];
    session.model = usedRef;
    if (session.title === "New session") {
      const firstUser = messages.find((m) => m.role === "user");
      const t = firstUser?.parts?.find((p) => p.type === "text") as { text?: string } | undefined;
      if (t?.text) session.title = t.text.slice(0, 48);
    }
    store.save(session);
    store.addUsage(session.id, usage);
  };
  const onFallback = (from: string, to: string, reason: string) =>
    console.warn(`[fallback] ${from} → ${to}: ${redactText(reason).slice(0, 200)}`);

  // PAV Loop (opt-in): Plan → Apply → Verify pipeline instead of a plain turn.
  const stream = body.pav
    ? runPavLoop({
        messages,
        modelRef,
        cwd: WS_ROOT,
        extraTools,
        disabledTools: [...disabledTools],
        system: turnSystem,
        onFallback,
        onFinishTurn,
      })
    : runAgentTurn({
        messages,
        modelRef,
        mode,
        cwd: WS_ROOT,
        extraTools,
        disabledTools: [...disabledTools],
        orchestrate: body.orchestrate,
        // Enable the y/n/always approval gate only when the client can answer prompts.
        approval: body.approvals ? { waitForDecision: (id) => waitForDecision(id) } : undefined,
        system: turnSystem,
        onFallback,
        onFinishTurn,
      });

  return createUIMessageStreamResponse({ stream });
});

// ---- tool permission decisions (answers a data-permission-request) ----
app.post("/api/permission", async (c) => {
  const { id, decision } = PermissionDecisionSchema.parse(await c.req.json());
  const resolve = pendingApprovals.get(id);
  if (!resolve) return c.json({ error: "unknown or expired request" }, 404);
  resolve(decision);
  return c.json({ ok: true });
});

// ---- compare ----
app.post("/api/compare", async (c) => {
  const body = CompareRequestSchema.parse(await c.req.json());
  const results = await compareModels(body.prompt, body.models);
  return c.json({ results });
});

// ---- share links (local, zero external service) ----
app.post("/api/share/:id", (c) => {
  const s = store.get(c.req.param("id"));
  if (!s) return c.json({ error: "not found" }, 404);
  const shareId = s.id.slice(0, 8);
  shared.set(shareId, JSON.stringify(redactValue(s)));
  return c.json({ url: `/s/${shareId}` });
});
app.get("/s/:id", (c) => {
  const snapshot = shared.get(c.req.param("id"));
  if (!snapshot) return c.text("Shared session not found", 404);
  const s = JSON.parse(snapshot) as { title: string; messages: UIMessage[] };
  const rows = s.messages
    .map((m) => {
      const text = (m.parts ?? [])
        .map((p) => ((p as { type: string; text?: string }).type === "text" ? (p as { text?: string }).text : ""))
        .join("");
      return `<div class="msg ${escapeHtml(m.role)}"><b>${escapeHtml(m.role)}</b><pre>${escapeHtml(text)}</pre></div>`;
    })
    .join("");
  return c.html(
    `<!doctype html><title>${escapeHtml(s.title)} — Personacode</title><style>body{font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}.msg{margin:1rem 0;padding:.75rem 1rem;border-radius:12px;background:#f4f4f7}.msg.user{background:#e8eefc}pre{white-space:pre-wrap;margin:.5rem 0 0;font:inherit}</style><h2>${escapeHtml(s.title)}</h2>${rows}`
  );
});

// ---- static web app (built by apps/web → served here in prod) ----
const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", (c) => c.html(readFileSync(join(webDist, "index.html"), "utf8")));
}

const port = Number(process.env.PERSONACODE_PORT ?? 3789);
const hostname = process.env.PERSONACODE_HOST ?? "127.0.0.1";

// PID file so `pcode --stop` can find and stop this server (even one we spawned and
// detached). Lives in the git-ignored .personacode/ dir, keyed by port.
const pidFile = join(WS_ROOT, ".personacode", `server-${port}.pid`);
function writePidFile(): void {
  try {
    mkdirSync(join(WS_ROOT, ".personacode"), { recursive: true });
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, hostname, mock: isMockMode() }), "utf8");
  } catch {
    /* best-effort — stop-by-PID just won't be available */
  }
}
function removePidFile(): void {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    /* ignore */
  }
}

serve({ fetch: app.fetch, port, hostname }, () => {
  writePidFile();
  console.log(
    `Personacode server → http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}  ${isMockMode() ? "(MOCK MODE — no keys needed)" : ""}`
  );
  void startChannelHub();
  void startScheduledAgents();
});

// Always clean up the PID file and stop channels on the way out, however we exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    removePidFile();
    void stopChannelHub().finally(() => process.exit(0));
  });
}
process.once("exit", removePidFile);

const channelQueues = new Map<string, Promise<void>>();
const startedAdapters: ChannelAdapter[] = [];
const scheduledJobs = new Map<string, { stop(): void }>();
const activeSchedules = new Map<string, Promise<void>>();

async function systemForAgent(base: string, agent?: AgentDefinition): Promise<string | undefined> {
  if (!agent) return base || undefined;
  const selectedSkills = agent.skills.length
    ? (await listSkills(WS_ROOT)).filter((skill) => agent.skills.includes(skill.name))
    : [];
  const skillInstructions = selectedSkills
    .map((skill) => `SKILL: ${skill.name}\n${skill.body}`)
    .join("\n\n")
    .slice(0, 20_000);
  return [base, agent.systemPrompt, skillInstructions].filter(Boolean).join("\n\n") || undefined;
}

function channelMode(): Mode {
  if (process.env.PERSONACODE_CHANNEL_UNSAFE_TOOLS !== "1") return "plan";
  const configured = process.env.PERSONACODE_CHANNEL_MODE;
  return configured === "default" || configured === "auto" || configured === "edit" ? configured : "plan";
}

async function handleChannelMessage(adapter: ChannelAdapter, message: ChannelMessage): Promise<void> {
  const key = `${message.channel}:${message.conversationId}`;
  const boundAgent = (await listAgentDefinitions(WS_ROOT))
    .map(({ agent }) => agent)
    .find((agent) => agent.channels.includes(message.channel));
  let session = channelSessions.get(key) ? store.get(channelSessions.get(key)!) : undefined;
  if (!session) {
    session = store.create({
      title: `${message.channel}: ${message.from}`.slice(0, 80),
      model: boundAgent?.model ?? defaultModelRef(),
      mode: boundAgent ? safeChannelMode(boundAgent) : channelMode(),
    });
    channelSessions.set(key, session.id);
  }

  const userMessage: UIMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: message.text }],
  };
  const messages = [...(session.messages as UIMessage[]), userMessage];
  const context = await buildProjectContext({ cwd: WS_ROOT, query: message.text });
  const mode = boundAgent ? safeChannelMode(boundAgent) : channelMode();
  const disabledTools = boundAgent?.tools.length
    ? BUILTIN_TOOL_NAMES.filter((name) => !boundAgent.tools.includes(name))
    : undefined;
  let reply = "";
  const stream = runAgentTurn({
    messages,
    modelRef: boundAgent?.model ?? session.model,
    mode,
    cwd: WS_ROOT,
    disabledTools,
    system: await systemForAgent(context.system, boundAgent),
    onFinishTurn: ({ text, usage, modelRef }) => {
      reply = text;
      session.messages = [
        ...messages,
        { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] },
      ];
      session.model = modelRef;
      store.save(session);
      store.addUsage(session.id, usage);
    },
  });

  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // The turn runs while its stream is consumed; the final text arrives via onFinishTurn.
  }
  if (!reply.trim()) throw new Error("agent returned an empty channel reply");
  await adapter.send(message.conversationId, reply);
}

function safeChannelMode(agent: AgentDefinition): Mode {
  return process.env.PERSONACODE_CHANNEL_UNSAFE_TOOLS === "1" ? agent.mode : "plan";
}

function enqueueChannelMessage(adapter: ChannelAdapter, message: ChannelMessage): Promise<void> {
  const key = `${message.channel}:${message.conversationId}`;
  const previous = channelQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => handleChannelMessage(adapter, message))
    .catch((error) => {
      console.warn(`[channels:${adapter.id}] message failed: ${redactText(error instanceof Error ? error.message : String(error))}`);
    })
    .finally(() => {
      if (channelQueues.get(key) === current) channelQueues.delete(key);
    });
  channelQueues.set(key, current);
  return current;
}

async function startChannelHub(): Promise<void> {
  if (process.env.PERSONACODE_CHANNELS !== "1") return;
  const { allAdapters } = await import("@personacode/channels");
  for (const adapter of allAdapters) {
    if (!adapter.available) continue;
    try {
      await adapter.start((message) => enqueueChannelMessage(adapter, message));
      startedAdapters.push(adapter);
      console.log(`[channels] ${adapter.id} started`);
    } catch (error) {
      console.warn(`[channels:${adapter.id}] start failed: ${redactText(error instanceof Error ? error.message : String(error))}`);
    }
  }
}

async function stopChannelHub(): Promise<void> {
  await Promise.allSettled(startedAdapters.map((adapter) => adapter.stop()));
  scheduledJobs.forEach((job) => job.stop());
}

async function runScheduledAgent(agent: AgentDefinition): Promise<void> {
  const key = `schedule:${agent.name.toLowerCase()}`;
  let session = channelSessions.get(key) ? store.get(channelSessions.get(key)!) : undefined;
  const mode: Mode = process.env.PERSONACODE_SCHEDULE_UNSAFE_TOOLS === "1" ? agent.mode : "plan";
  if (!session) {
    session = store.create({ title: `Scheduled: ${agent.name}`, model: agent.model ?? defaultModelRef(), mode });
    channelSessions.set(key, session.id);
  }
  const userMessage: UIMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: "Run your scheduled task now and report the result." }],
  };
  const messages = [...(session.messages as UIMessage[]), userMessage];
  const context = await buildProjectContext({ cwd: WS_ROOT, query: `scheduled task ${agent.name}` });
  const disabledTools = agent.tools.length
    ? BUILTIN_TOOL_NAMES.filter((name) => !agent.tools.includes(name))
    : undefined;
  const stream = runAgentTurn({
    messages,
    modelRef: agent.model ?? session.model,
    mode,
    cwd: WS_ROOT,
    disabledTools,
    system: await systemForAgent(context.system, agent),
    onFinishTurn: ({ text, usage, modelRef }) => {
      session.messages = [...messages, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] }];
      session.model = modelRef;
      store.save(session);
      store.addUsage(session.id, usage);
    },
  });
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // Consume the stream to drive the scheduled turn to completion.
  }
}

async function startScheduledAgents(): Promise<void> {
  for (const { agent } of await listAgentDefinitions(WS_ROOT)) {
    await registerScheduledAgent(agent);
  }
}

async function registerScheduledAgent(agent: AgentDefinition): Promise<void> {
  if (!agent.schedule || scheduledJobs.has(agent.name.toLowerCase())) return;
  const { default: cron } = await import("node-cron");
  if (!cron.validate(agent.schedule)) return;
  const key = agent.name.toLowerCase();
  const job = cron.schedule(agent.schedule, () => {
    if (activeSchedules.has(key)) return;
    const running = runScheduledAgent(agent)
      .catch((error) =>
        console.warn(`[schedule:${agent.name}] failed: ${redactText(error instanceof Error ? error.message : String(error))}`),
      )
      .finally(() => activeSchedules.delete(key));
    activeSchedules.set(key, running);
  });
  scheduledJobs.set(key, job);
  console.log(`[schedule] ${agent.name} registered (${agent.schedule})`);
}

