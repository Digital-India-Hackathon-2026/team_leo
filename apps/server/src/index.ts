import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createUIMessageStreamResponse } from "ai";
import type { UIMessage } from "ai";
import {
  ChatRequestSchema,
  CompareRequestSchema,
  CreateSessionRequestSchema,
  PermissionDecisionSchema,
} from "@personacode/contracts";
import type { TokenUsage } from "@personacode/contracts";
import {
  SessionStore,
  CheckpointStore,
  buildProjectContext,
  compareModels,
  contextWindowFor,
  defaultModelRef,
  getMcpManager,
  isMockMode,
  listMemories,
  listModels,
  listProviders,
  listSkills,
  runAgentTurn,
  runPavLoop,
} from "@personacode/core";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile as fsReadFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
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

const app = new Hono();
const store = new SessionStore();
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

app.use("/api/*", cors());

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
const checkpoints = new CheckpointStore(WS_ROOT);
const WS_IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".turbo", "coverage", ".personacode", ".pnpm",
  ".claude", ".playwright-mcp", ".understand-anything", ".vscode", ".idea",
]);
function isSecretPath(rel: string): boolean {
  const base = rel.split(/[\\/]/).pop() ?? "";
  return /^\.env(\.|$)/.test(base) && base !== ".env.example";
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
  const full = resolve(WS_ROOT, rel);
  // Guard against path traversal and secret files.
  if (full !== WS_ROOT && !full.startsWith(WS_ROOT + sep)) return c.json({ error: "outside workspace" }, 403);
  if (isSecretPath(rel)) return c.json({ error: "not readable" }, 403);
  try {
    const content = await fsReadFile(full, "utf8");
    return c.json({ path: rel, content: content.slice(0, 200_000), truncated: content.length > 200_000 });
  } catch {
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

// ---- checkpoints (shadow-git rewind) ----
app.get("/api/checkpoints", async (c) => c.json({ checkpoints: await checkpoints.list() }));
app.post("/api/checkpoints/restore", async (c) => {
  const { hash } = (await c.req.json().catch(() => ({}))) as { hash?: string };
  if (!hash) return c.json({ error: "hash required" }, 400);
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

// ---- chat (AI SDK v5 UIMessage stream, useChat-compatible) ----
app.post("/api/chat", async (c) => {
  const body = ChatRequestSchema.parse(await c.req.json());
  const messages = body.messages as UIMessage[];
  const session = body.sessionId ? store.get(body.sessionId) : undefined;
  const modelRef = body.model ?? session?.model ?? defaultModelRef();
  const mode = body.mode ?? session?.mode ?? "default";

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
    checkpoints
      .snapshot(`before: ${query.slice(0, 60) || "turn"}`)
      .catch((err) => console.warn(`[checkpoint] skipped: ${err instanceof Error ? err.message : err}`));
  }

  // Connect configured MCP servers (memoized) and expose their tools this turn.
  const mcp = getMcpManager();
  await mcp.ensureConnected(WS_ROOT);
  const extraTools = mcp.buildToolSet({ mode, disabled: new Set(body.disabledTools ?? []) });

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
    console.warn(`[fallback] ${from} → ${to}: ${reason.slice(0, 200)}`);

  // PAV Loop (opt-in): Plan → Apply → Verify pipeline instead of a plain turn.
  const stream = body.pav
    ? runPavLoop({
        messages,
        modelRef,
        cwd: WS_ROOT,
        extraTools,
        disabledTools: body.disabledTools,
        system: ctx.system || undefined,
        onFallback,
        onFinishTurn,
      })
    : runAgentTurn({
        messages,
        modelRef,
        mode,
        cwd: WS_ROOT,
        extraTools,
        disabledTools: body.disabledTools,
        orchestrate: body.orchestrate,
        // Enable the y/n/always approval gate only when the client can answer prompts.
        approval: body.approvals ? { waitForDecision: (id) => waitForDecision(id) } : undefined,
        system: ctx.system || undefined,
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
  shared.set(shareId, JSON.stringify(s));
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
      return `<div class="msg ${m.role}"><b>${m.role}</b><pre>${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre></div>`;
    })
    .join("");
  return c.html(
    `<!doctype html><title>${s.title} — Personacode</title><style>body{font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}.msg{margin:1rem 0;padding:.75rem 1rem;border-radius:12px;background:#f4f4f7}.msg.user{background:#e8eefc}pre{white-space:pre-wrap;margin:.5rem 0 0;font:inherit}</style><h2>${s.title}</h2>${rows}`
  );
});

// ---- static web app (built by apps/web → served here in prod) ----
const webDist = join(process.cwd(), "..", "web", "dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: "../web/dist" }));
  app.get("*", (c) => c.html(readFileSync(join(webDist, "index.html"), "utf8")));
}

const port = Number(process.env.PERSONACODE_PORT ?? 3789);
serve({ fetch: app.fetch, port }, () => {
  console.log(
    `Personacode server → http://localhost:${port}  ${isMockMode() ? "(MOCK MODE — no keys needed)" : ""}`
  );
});
