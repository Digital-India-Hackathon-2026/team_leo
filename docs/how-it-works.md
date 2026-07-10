# How Personacode works — architecture + hackathon Q&A

A reference for explaining the project and answering questions, **basic → advanced**.
Everything here is grounded in the actual code (files cited) and the token-reduction
methods are cross-checked against how mainstream agents do the same thing (sources at end).

---

## 1. What Personacode is (elevator answer)
Open-source, **privacy-first** agent platform: a Claude-Code-style **CLI** *and* a
self-hosted **web app**, that works with **any LLM — free or paid**, and runs on your own
machine so your code and keys never leave it. It ships every no-card free tier (Google AI
Studio, Groq, Cerebras, OpenRouter `:free`, NVIDIA NIM, GitHub Models, OpenCode Zen free,
local Ollama) and **defaults to free** — but you can bring paid keys anytime. Headline
trick: **automatic fallback across providers** — if one runs out or its key dies, it hands
off to the next mid-conversation.

## 2. Architecture (monorepo: contracts → core → apps + channels)
- **`packages/contracts`** — Zod schemas + the REST API contract. The single source of
  truth every package imports; frozen (only Dev A edits). Keeps web/CLI/channels in sync.
- **`packages/core`** — the engine:
  - `providers/` — 8-provider catalog + registry (model factory, fallback chain, per-provider
    cooldowns, mock model).
  - `agent/` — `loop.ts` (streaming turn), `turn.ts` (shared `pumpTurn` streaming+fallback
    primitive), `compaction.ts` (auto-compaction), `scout.ts` (Model Crew), `pav.ts` (PAV
    loop), `verify.ts` (runs repo test/typecheck scripts).
  - `tools/` — bash/read/write/list/web_fetch with a per-mode policy + **Token Diet** +
    permission gate.
  - `context/` (PERSONA.md + memory recall + skills), `mcp/` (stdio+HTTP client),
    `checkpoints/` (shadow-git rewind), `storage/` (JSON stores).
- **`apps/server`** — one Hono server on `:3789`. Streaming `/api/chat` (injects context,
  MCP tools, orchestration/PAV, auto-checkpoints, mediates permission prompts), sessions
  CRUD, models/providers, usage, compare, memory/skills/checkpoints, share links, and serves
  the built web app. **All LLM calls go through here — keys never reach the browser or logs.**
- **`apps/cli`** — Ink terminal UI, routed *through the server* so it inherits every feature;
  slash commands, modes (Shift+Tab), statusline with live token %.
- **`apps/web`** — Vite + React chat: streaming, sessions, model/mode pickers, ⚡ Crew & ⚙ PAV
  toggles, workspace panel, Compare/Settings/Notes/Tasks/Gallery/Cookbook pages, themes.
- **`packages/channels`** — Telegram/Discord/Email/Slack adapters (one `ChannelAdapter`
  interface) so the agent is reachable from chat apps, wired in via the server's "Agent Hub".

## 3. Life of a chat turn (walk-through)
1. User sends a message → `POST /api/chat` (web and CLI both hit the same endpoint).
2. Server builds **project context** (PERSONA.md + memory recalled by keyword + skills
   catalog) and injects it as system text.
3. **Auto-checkpoint** (shadow git) before any file-changing turn, so `/rewind` works.
4. Connects configured **MCP** servers, exposing their tools for this turn.
5. `runAgentTurn` streams from the chosen provider via `pumpTurn`. **If it errors on a
   rate-limit / quota / dead-key**, that provider is cooled down for 5 min and the turn
   **hands off** to the next provider with a "continue, don't restart" note.
6. Tools run under a **per-mode policy** (plan = read-only, edit = no shell, default/auto =
   all), with **Token Diet** trimming their output and **permission prompts** (y/n/always)
   for bash/write in Default mode.
7. If history nears the model's context window, **auto-compaction** summarizes older turns.
   Output streams as UIMessage chunks (text + `data-fallback` / `data-orchestration` /
   `data-pav` / `data-permission-request` / `data-compaction`).
8. Session + token usage are persisted.

## 4. Multi-provider fallback + handoff (the headline)
Every model is referenced as `provider/model` through the Vercel AI SDK's uniform interface,
so the engine treats all providers the same. When a call fails with a rate-limit / quota /
overload / auth (dead key) error, the engine **cools that provider down for 5 minutes** and
**retries the same turn on the next provider in the chain**, prepending a short handoff note
so the new model continues seamlessly instead of restarting. This is both a reliability and a
**cost** feature: it spreads load across 8 free tiers and multiplies effective free quota.
Live demo: kill the Google key mid-answer → Groq finishes it.

## 5. Token & cost reduction methods  ← the core question
All of these are **model-agnostic**: they transform the *text and message array before the
API call* (through the SDK's uniform interface), so they need **no model-specific feature**
and work with any provider the SDK can reach (OpenAI-compatible, Gemini, Anthropic, local
Ollama, etc.). This is exactly how mainstream agents do it.

| Method | What it does | Where | Model-agnostic? | Honest caveat |
|---|---|---|---|---|
| **Token Diet** | Caps each tool output at 8k chars (keeps head+tail, marks the trimmed middle); `web_fetch` also strips HTML/scripts/styles | `packages/core/src/tools/index.ts` (`diet()`) | ✅ pure text preprocessing | A giant *relevant* middle could be cut — but head+tail is where signal usually sits |
| **Auto-compaction** | Past 70% of the model's context window, summarizes older turns (via the model itself), keeps the last 6 verbatim, carries the summary in the system prompt; fail-soft | `agent/compaction.ts` | ✅ threshold scales to each model's window | Summaries are lossy → mitigated by keeping recent turns + fail-soft |
| **Model Crew brief** | A fast "scout" reads the ≤12 relevant files **once** and injects a brief so the strong model doesn't burn tool round-trips re-reading; briefs fan out across providers | `agent/scout.ts`, `providers/roles.ts` | ✅ | Adds a couple of fast calls up front; worth it when a task touches many files |
| **Context-window tracking** | Per-model context windows drive the compaction threshold + the live usage % | `providers/registry.ts` (`contextWindowFor`) | ✅ | — |
| **Minimal system prompt** | The base system prompt is deliberately ~3 lines; sub-agents (scout summarizer, PAV planner) are told "be terse" | `agent/turn.ts`, `scout.ts`, `pav.ts` | ✅ | There is **no "compress every reply" toggle** — only the minimal-prompt + terse-subagent reality |
| **Free-tier fallback** (cost) | Spreads load across 8 free providers; a dead/limited provider hands off to the next → multiplies effective free quota | `agent/turn.ts` + `registry.ts` cooldowns | ✅ | — |

**Token estimate = chars ÷ 4** (`approxTokens`): a deliberate **heuristic for a *threshold
decision*, not for billing**. Real tokenizers differ per model (BPE for GPT, SentencePiece
for Gemini/Llama), but a rough cross-model average is enough to decide *when* to compact, and
it keeps us dependency-free (no per-model tokenizer). For exact counts we read the provider's
returned usage.

**Why this is "good" and generalizes:** these map 1:1 to recognized production techniques —
tool-output truncation, threshold-triggered conversation summarization, and context
offloading — which the literature calls "free, fast, high impact," and which Cursor, Claude
Code, Trae (16 KB tool-output cap), and SWE-agent all use. They are model-independent **by
construction** because they operate on prompts/messages, not on any provider API.

## 6. Q&A cheat-sheet (basic → advanced)

### Basic
- **What is it?** → Local, private, open-source agent (CLI + web) that works with any LLM,
  free or paid, and defaults to free tiers.
- **Is it really free?** → Yes by default — 8 no-card free providers + local Ollama; paid
  keys optional.
- **What can it do?** → Chat, edit code with tools, MCP servers, skills, memory, checkpoints /
  rewind, modes, compare models, share sessions, and reply on Telegram/Discord/email.

### Intermediate
- **How does it support so many providers?** → One registry + the AI SDK's uniform interface;
  every model is `provider/model`; the server proxies all calls so keys stay server-side.
- **What if a provider rate-limits or the key dies mid-chat?** → Automatic fallback: cool that
  provider 5 min, hand off to the next with a note so the new model **continues**. (Demo: kill
  the Google key → Groq finishes the answer.)
- **How do you reduce tokens / cost?** → Token Diet (cap tool output), auto-compaction
  (summarize old turns), Model Crew brief (read files once), free-tier fallback.
- **Does the token stuff work with any LLM?** → Yes — it all happens on the text/messages
  before the call; no model-specific API needed.

### Advanced
- **Exactly when/how does compaction fire?** → chars/4 estimate vs 70% of the model's window;
  summarize older turns with the model, keep the last 6 verbatim, carry the summary in
  `system` (AI SDK v7 forbids system messages inside `messages`), fail-soft if summarization
  fails.
- **Isn't chars/4 inaccurate?** → It's a threshold heuristic, not billing; exact usage comes
  from the provider response. Dependency-free on purpose.
- **Doesn't truncation / summarization lose info?** → Truncation keeps head+tail + a marker;
  summarization keeps recent turns verbatim + fail-soft. Standard trade-off (same as Cursor /
  Claude Code / Trae).
- **What makes Model Crew different from one model?** → A fast scout picks relevant files; fast
  summarizers brief them **in parallel across different providers** (multiplying free quotas);
  the strong "brain" starts already-informed → fewer slow tool loops + parallel speed. The
  reviewer role deliberately uses a *different* provider than the brain.
- **What's the PAV loop?** → Plan → Apply → Verify: the brain drafts a plan (saved to
  `.personacode/plans/`), an edit pass applies it, then it runs **your repo's own typecheck /
  test scripts**; on failure it feeds the errors back and re-applies. Only package.json scripts
  run — never model-suggested shell (safe).
- **Prompt caching?** → The stable system-prompt-first ordering is cache-friendly where
  providers support implicit caching (Anthropic / OpenAI / Gemini); a no-op elsewhere, never
  harmful.
- **Security / privacy?** → Server proxies all LLM calls; keys only in git-ignored `.env`,
  never sent to the browser or logged; file tools are path-traversal-guarded and block `.env`;
  per-mode tool policy + permission prompts.
- **What's genuinely novel vs Claude Code?** → Multi-provider fallback + handoff across free
  tiers, Model Crew parallel multi-model orchestration, local web + share links, and channels —
  Claude Code doesn't do these.

---

## Sources (for "is this a real technique?")
- [Techniques to manage context length in LLMs — agenta.ai](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms)
- [LLM chat-history summarization guide — mem0.ai](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [Compress your agent's context without losing what matters — dev.to](https://dev.to/mukundakatta/compress-your-agents-context-without-losing-what-matters-303)
