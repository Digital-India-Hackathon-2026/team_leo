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
} from "@personacode/contracts";
import {
  SessionStore,
  compareModels,
  contextWindowFor,
  defaultModelRef,
  isMockMode,
  listModels,
  listProviders,
  runAgentTurn,
} from "@personacode/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";

const app = new Hono();
const store = new SessionStore();
const shared = new Map<string, string>(); // shareId → frozen session JSON

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, mock: isMockMode() }));
app.get("/api/providers", (c) => c.json(listProviders()));
app.get("/api/models", (c) => c.json(listModels()));

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

  const stream = runAgentTurn({
    messages,
    modelRef,
    mode,
    onFallback: (from, to, reason) =>
      console.warn(`[fallback] ${from} → ${to}: ${reason.slice(0, 200)}`),
    onFinishTurn: ({ text, usage, modelRef: usedRef }) => {
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
    },
  });

  return createUIMessageStreamResponse({ stream });
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
