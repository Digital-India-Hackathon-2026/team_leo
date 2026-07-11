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
 *   POST /api/chat                       → UIMessage SSE stream  (body: ChatRequest; AI SDK v7 useChat-compatible)
 *                                          data chunks: data-fallback, data-compaction, data-orchestration (Model Crew),
 *                                          data-pav (PAV loop, see PavStage), data-permission-request (approvals)
 *   GET  /api/sessions/:id/usage        → UsageReport
 *   POST /api/compare                    → CompareResponse       (body: CompareRequest)
 *   POST /api/share/:id                  → { url: string }       (freeze session snapshot)
 *   GET  /s/:id                          → shared session page (HTML)
 *   GET/POST /api/notes                 → Note[] / Note
 *   PUT/PATCH/DELETE /api/notes/:id     → Note / { ok: true }
 *   GET/POST /api/tasks                 → Task[] / Task
 *   PATCH/DELETE /api/tasks/:id         → Task / { ok: true }
 *   GET  /api/cookbook                  → CookbookResult
 *   GET  /api/hooks                     → HookConfig
 *   GET/POST /api/setup-scout           → SetupScoutResponse
 *   GET/POST /api/agents                → CreateAgentResponse[] / CreateAgentResponse
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

export const LanguageCodeSchema = z.enum([
  "hi", "bn", "ta", "te", "mr", "kn", "gu", "ml", "pa", "or", "as", "ur",
]);
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  kn: "Kannada",
  gu: "Gujarati",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

// ---------- Model Crew (multi-model orchestration) ----------
export const ModelRoleSchema = z.enum(["scout", "summarizer", "brain", "reviewer", "router"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export const AutoTaskKindSchema = z.enum(["code", "chat", "research", "long-context"]);
export type AutoTaskKind = z.infer<typeof AutoTaskKindSchema>;

/** One step of the scout pipeline, streamed to clients as a `data-orchestration` chunk. */
export const OrchestrationStageSchema = z.object({
  stage: z.enum(["route", "scout", "brief", "review"]),
  model: z.string(),
  ms: z.number(),
  detail: z.string(),
  kind: AutoTaskKindSchema.optional(),
  mode: ModeSchema.optional(),
});
export type OrchestrationStage = z.infer<typeof OrchestrationStageSchema>;

// ---------- PAV Loop (Plan → Apply → Verify) ----------
/**
 * One phase of the PAV loop, streamed to clients as a `data-pav` chunk (opt-in via
 * ChatRequest.pav). Render as a pipeline: plan (with the plan markdown + saved path),
 * one or more apply/verify iterations, then done (passed = whether checks went green).
 */
export const PavStageSchema = z.object({
  phase: z.enum(["plan", "apply", "review", "verify", "done"]),
  detail: z.string(),
  model: z.string().optional(),
  ms: z.number().optional(),
  iteration: z.number().optional(),
  passed: z.boolean().optional(),
  /** plan phase: the generated plan markdown + workspace-relative path it was saved to. */
  plan: z.string().optional(),
  planPath: z.string().optional(),
  /** verify phase: the command run and (on failure) its captured output. */
  command: z.string().optional(),
  output: z.string().optional(),
});
export type PavStage = z.infer<typeof PavStageSchema>;

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
  language: LanguageCodeSchema.optional(),
  terse: z.boolean().optional(),
  usage: TokenUsageSchema,
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;

/**
 * Messages are AI SDK v7 UIMessage objects; we deliberately pass them through
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
  language: LanguageCodeSchema.optional(),
  terse: z.boolean().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(),
  messages: z.array(z.unknown()),
  model: z.string().optional(),
  /** Saved agent definition name from `.personacode/agents/`. */
  agent: z.string().trim().min(1).max(100).optional(),
  mode: ModeSchema.optional(),
  /** Bharat Mode response language. null clears a saved session preference. */
  language: LanguageCodeSchema.nullable().optional(),
  /** Terse Mode: minimal-token user-facing responses without reducing tool quality. */
  terse: z.boolean().optional(),
  /** Qualified tool names toggled off for this turn (builtins or MCP mcp__server__tool). */
  disabledTools: z.array(z.string()).optional(),
  /** Model Crew: run the multi-model scout→brief pipeline before the brain turn. */
  orchestrate: z.boolean().optional(),
  /** PAV Loop: run Plan→Apply→Verify (streams `data-pav` chunks) instead of a plain turn. */
  pav: z.boolean().optional(),
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

export const CreateNoteRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
});
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;

export const UpdateNoteRequestSchema = CreateNoteRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "at least one note field is required",
);
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;

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

export const CreateTaskRequestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  schedule: z.string().trim().min(1).max(200).optional(),
  agent: z.string().trim().min(1).max(100).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    done: z.boolean().optional(),
    schedule: z.string().trim().min(1).max(200).nullable().optional(),
    agent: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "at least one task field is required");
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

// ---------- Cookbook ----------

export const HardwareInfoSchema = z.object({
  ram: z.object({ totalGB: z.number(), freeGB: z.number() }),
  cpu: z.object({ brand: z.string(), cores: z.number(), speedGHz: z.number() }),
  gpu: z.array(z.object({ model: z.string(), vramMB: z.number() })),
});
export type HardwareInfo = z.infer<typeof HardwareInfoSchema>;

export const ModelRecommendationSchema = z.object({
  name: z.string(),
  parameterSize: z.string(),
  quantization: z.string(),
  minRAM: z.string(),
  pullCommand: z.string(),
  notes: z.string(),
  tier: z.enum(["tiny", "small", "medium", "large"]),
});
export type ModelRecommendation = z.infer<typeof ModelRecommendationSchema>;

export const CookbookResultSchema = z.object({
  hardware: HardwareInfoSchema,
  recommendations: z.array(ModelRecommendationSchema),
  installedModels: z.array(z.string()),
  summary: z.string(),
});
export type CookbookResult = z.infer<typeof CookbookResultSchema>;

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

// ---------- Hooks ----------

export const HookEntrySchema = z.object({
  /** Built-in tool name, `*`, or a comma-separated list. Omit for onFinish hooks. */
  matcher: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
});
export type HookEntry = z.infer<typeof HookEntrySchema>;

export const HookConfigSchema = z.object({
  preToolUse: z.array(HookEntrySchema).default([]),
  postToolUse: z.array(HookEntrySchema).default([]),
  onFinish: z.array(HookEntrySchema).default([]),
});
export type HookConfig = z.infer<typeof HookConfigSchema>;

// ---------- Agent definitions (superagents) ----------

/** Channels an agent can actively *push* a message to (send, not just answer). */
export const DeliveryChannelSchema = z.enum(["discord", "telegram", "email"]);
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;

/**
 * Non-secret delivery marker stored *in* the agent definition — safe to return to
 * clients. It records that the agent delivers, on which channel, and a non-secret
 * display target (an email address, a masked "#channel" hint). Credentials live
 * separately (DeliveryCredentials), server-side only, and are never returned.
 */
export const AgentDeliverySchema = z.object({
  channel: DeliveryChannelSchema,
  /** human-readable, non-secret target hint for the UI (e.g. an email or "#ai-news"). */
  target: z.string().max(200).optional(),
});
export type AgentDelivery = z.infer<typeof AgentDeliverySchema>;

/**
 * Per-agent delivery credentials, supplied at creation. Stored server-side only in the
 * git-ignored secrets store — NEVER logged and NEVER returned by any API. Each agent
 * carries its own creds, so one deployment can drive many bots / mailboxes.
 */
export const DeliveryCredentialsSchema = z
  .object({
    channel: DeliveryChannelSchema,
    // discord: a channel webhook URL (no bot infra needed)
    webhookUrl: z.string().url().max(500).optional(),
    // telegram: bot token + destination chat id
    botToken: z.string().trim().min(1).max(200).optional(),
    chatId: z.string().trim().min(1).max(100).optional(),
    // email: recipient (+ optional per-agent SMTP; else the global EMAIL_* env creds)
    to: z.string().email().optional(),
    smtpUser: z.string().trim().max(200).optional(),
    smtpPass: z.string().max(500).optional(),
    smtpHost: z.string().trim().max(200).optional(),
  })
  .refine(
    (d) =>
      d.channel === "discord"
        ? Boolean(d.webhookUrl)
        : d.channel === "telegram"
          ? Boolean(d.botToken && d.chatId)
          : Boolean(d.to),
    { message: "missing required credentials for the chosen delivery channel" },
  );
export type DeliveryCredentials = z.infer<typeof DeliveryCredentialsSchema>;

export const AgentDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
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
  /** where a scheduled/triggered run pushes its output (creds stored separately). */
  delivery: AgentDeliverySchema.optional(),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const CreateAgentRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  model: z.string().trim().min(1).optional(),
  /** optional per-agent delivery credentials, stored server-side only. */
  delivery: DeliveryCredentialsSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const CreateAgentResponseSchema = z.object({
  agent: AgentDefinitionSchema,
  path: z.string(),
});
export type CreateAgentResponse = z.infer<typeof CreateAgentResponseSchema>;

export const SetupScoutRequestSchema = z.object({ apply: z.boolean().default(false) });
export type SetupScoutRequest = z.infer<typeof SetupScoutRequestSchema>;

export const SetupRecommendationSchema = z.object({
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  content: z.string().optional(),
});
export const SetupScoutResponseSchema = z.object({
  detected: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    packageManager: z.string().optional(),
    scripts: z.array(z.string()),
  }),
  recommendations: z.object({
    mcpServers: z.array(SetupRecommendationSchema),
    skills: z.array(SetupRecommendationSchema),
    personaTemplate: z.string(),
  }),
  applied: z.array(z.string()).default([]),
});
export type SetupScoutResponse = z.infer<typeof SetupScoutResponseSchema>;
