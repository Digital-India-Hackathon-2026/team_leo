/**
 * @personacode/contracts — THE source of truth for every cross-package boundary.
 *
 * Rules (see docs/implementationplan.md §5):
 * - Only Dev A edits this package.
 * - apps/web (Dev B) and packages/channels (Dev C) import ONLY from here
 *   (plus their own package) — never from @personacode/core internals.
 *
 * REST API (all under http://localhost:3789):
 *   GET  /api/health                     → { ok: true, mock: boolean }
 *   GET  /api/providers                  → ProviderInfo[]        (for /connect + settings)
 *   GET  /api/models                     → ModelInfo[]           (flat list across configured providers)
 *   GET  /api/sessions                   → SessionMeta[]
 *   POST /api/sessions                   → SessionMeta           (body: CreateSessionRequest)
 *   GET  /api/sessions/:id               → Session
 *   DELETE /api/sessions/:id             → { ok: true }
 *   POST /api/chat                       → UIMessage SSE stream  (body: ChatRequest; AI SDK v5 useChat-compatible)
 *   GET  /api/sessions/:id/usage        → UsageReport
 *   POST /api/compare                    → CompareResponse       (body: CompareRequest)
 *   POST /api/share/:id                  → { url: string }       (freeze session snapshot)
 *   GET  /s/:id                          → shared session page (HTML)
 *   GET/POST/DELETE /api/notes, /api/tasks → Note[] / Task[] CRUD
 */
import { z } from "zod";

// ---------- Providers & models ----------

export const ProviderIdSchema = z.enum([
  "google",
  "groq",
  "cerebras",
  "openrouter",
  "nvidia",
  "github",
  "zen",
  "ollama",
  "mock",
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** Static catalog entry (packages/core/src/providers/providers.json) + runtime state. */
export const ProviderInfoSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  badge: z.enum(["free", "freemium", "local"]),
  keyUrl: z.string(),
  envVar: z.string(),
  baseUrl: z.string().optional(),
  defaultModel: z.string(),
  models: z.array(z.string()),
  /** Free-tier quota notes shown in /connect and the usage dashboard. */
  quotaNote: z.string(),
  /** Runtime: does the server have a key for this provider? (never the key itself) */
  configured: z.boolean().optional(),
  /** Runtime: provider is cooling down after a rate-limit/quota error until this epoch-ms. */
  coolingDownUntil: z.number().optional(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ModelInfoSchema = z.object({
  providerId: ProviderIdSchema,
  modelId: z.string(),
  /** "google/gemini-2.5-flash" — what the UI sends back in ChatRequest.model */
  ref: z.string(),
  contextWindow: z.number().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// ---------- Modes ----------

export const ModeSchema = z.enum(["default", "plan", "auto", "edit"]);
export type Mode = z.infer<typeof ModeSchema>;

// ---------- Model Crew (multi-model orchestration) ----------
export const ModelRoleSchema = z.enum(["scout", "summarizer", "brain", "reviewer", "router"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

/** One step of the scout pipeline, streamed to clients as a `data-orchestration` chunk. */
export const OrchestrationStageSchema = z.object({
  stage: z.enum(["scout", "brief", "review"]),
  model: z.string(),
  ms: z.number(),
  detail: z.string(),
});
export type OrchestrationStage = z.infer<typeof OrchestrationStageSchema>;

export const MODE_LABELS: Record<Mode, { chip: string; warning?: string }> = {
  default: { chip: "DEFAULT" },
  plan: { chip: "⏸ PLAN — read-only" },
  auto: { chip: "⚠ AUTO — runs commands without asking" },
  edit: { chip: "✎ EDIT — files only, no shell" },
};

// ---------- Usage ----------

export const TokenUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const UsageReportSchema = z.object({
  sessionId: z.string(),
  total: TokenUsageSchema,
  /** context tokens currently in play vs the active model's window, 0..1 */
  contextPercent: z.number(),
  byProvider: z.record(z.string(), TokenUsageSchema),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

// ---------- Sessions & chat ----------

export const SessionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  model: z.string(), // ModelInfo.ref
  mode: ModeSchema,
  usage: TokenUsageSchema,
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

/**
 * Messages are AI SDK v5 UIMessage objects; we deliberately pass them through
 * untyped here so web can use @ai-sdk/react verbatim.
 */
export const SessionSchema = SessionMetaSchema.extend({
  messages: z.array(z.unknown()),
});
export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionRequestSchema = z.object({
  title: z.string().optional(),
  model: z.string().optional(),
  mode: ModeSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  messages: z.array(z.unknown()),
  model: z.string().optional(),
  mode: ModeSchema.optional(),
  /** Qualified tool names toggled off for this turn (builtins or MCP mcp__server__tool). */
  disabledTools: z.array(z.string()).optional(),
  /** Model Crew: run the multi-model scout→brief pipeline before the brain turn. */
  orchestrate: z.boolean().optional(),
  /** Client can answer `data-permission-request` prompts (y/n/always) via POST /api/permission. */
  approvals: z.boolean().optional(),
});

// Client → server decision for a pending tool-approval request.
export const PermissionDecisionSchema = z.object({
  id: z.string(),
  decision: z.enum(["allow", "deny", "always"]),
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ---------- Compare ----------

export const CompareRequestSchema = z.object({
  prompt: z.string(),
  models: z.array(z.string()).min(2).max(6), // ModelInfo.refs
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

export const CompareResultSchema = z.object({
  model: z.string(),
  text: z.string(),
  usage: TokenUsageSchema.optional(),
  ms: z.number(),
  error: z.string().optional(),
});
export const CompareResponseSchema = z.object({
  results: z.array(CompareResultSchema),
});
export type CompareResult = z.infer<typeof CompareResultSchema>;
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

// ---------- Notes & tasks ----------

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  tags: z.array(z.string()).default([]),
});
export type Note = z.infer<typeof NoteSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean().default(false),
  createdAt: z.number(),
  /** cron expression if this is a scheduled agent task */
  schedule: z.string().optional(),
  /** agent definition name from .personacode/agents/ to run on schedule */
  agent: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ---------- Channels (Dev C implements against these) ----------

export const ChannelIdSchema = z.enum([
  "telegram",
  "discord",
  "email",
  "slack",
  "whatsapp",
  "sms",
  "googlechat",
  "teams",
]);
export type ChannelId = z.infer<typeof ChannelIdSchema>;

export const ChannelMessageSchema = z.object({
  channel: ChannelIdSchema,
  /** channel-native conversation id (chat id, channel id, email thread id…) */
  conversationId: z.string(),
  /** channel-native sender id/handle */
  from: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

/**
 * Every channel implements exactly this. The server (Agent Hub) calls
 * start()/stop() and provides onMessage; the adapter calls onMessage for each
 * inbound message and must be able to send() an outbound reply.
 * Adapters read their own credentials from process.env (see .env.example).
 */
export interface ChannelAdapter {
  id: ChannelId;
  /** false → adapter is a "coming soon" stub; server skips start() */
  available: boolean;
  start(onMessage: (msg: ChannelMessage) => Promise<void>): Promise<void>;
  send(conversationId: string, text: string): Promise<void>;
  stop(): Promise<void>;
}

// ---------- Agent definitions (superagents) ----------

export const AgentDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  model: z.string().optional(), // ModelInfo.ref; empty → auto
  tools: z.array(z.string()).default([]), // tool names allowlist; empty → all enabled tools
  skills: z.array(z.string()).default([]),
  /** channel bindings: this agent answers messages on these channels */
  channels: z.array(ChannelIdSchema).default([]),
  /** cron expression for scheduled runs */
  schedule: z.string().optional(),
  mode: ModeSchema.default("default"),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
