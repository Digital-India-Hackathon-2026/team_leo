# Personacode

Open-source, privacy-first agent platform: a Claude-Code-style CLI **and** self-hosted web app with multi-provider LLM support (free tiers only), MCP, skills, memory, agent modes, channels (Telegram/Discord/Email), and more. Built in ~3 days for a hackathon by a 3-person team.

**THE source of truth is [docs/implementationplan.md](docs/implementationplan.md). Read it fully before doing anything.** It contains: naming/legal rules, locked tech stack, repo layout, free-provider strategy, feature triage (Tier 1/2/3), team assignments, day-by-day timeline, and verification steps. Pre-event signups/installs: [docs/pre-hackathon-checklist.md](docs/pre-hackathon-checklist.md).

## Status: Day 1 IN PROGRESS (2026-07-10)

- Repo is **live** on the hackathon remote `github.com/Digital-India-Hackathon-2026/team_leo` (branches `main` + `core`/`web`/`channels`; `ORIGINAL_SUBMISSION.md` preserved). Dev A works on `core`, merges to `main`.
- **Live providers work.** `.env` has real keys (also mirrored in git-ignored `docs/API.md`). Fallback + handoff verified end-to-end (kill Google key → hands off to Groq → real answer).

### Day 1 worklist (Dev A)

1. ✅ `git init` + push to `team_leo` (main + core/web/channels).
2. ✅ `.env` + live-provider smoke test + **fallback/handoff** (fixed 4 real bugs — see Gotchas).
3. ⏳ Interactive CLI test — CLI runs via new **`pcode`** command; needs a real terminal to click through.
4. MCP client (stdio + HTTP) with per-tool toggles; memory (PERSONA.md + `.personacode/memory/`); skills loader; slash commands `/connect` `/usage` `/compact` `/init`; checkpoints (shadow git in `.personacode/checkpoints/`); CLI permission prompts (y/n/always) in default mode; auto-compaction.
5. **Model Crew** — multi-model orchestration for fast turns (full design: plan §4 #21): fast scout model picks ≤12 files from a local repo tree, summarizer models brief them in parallel round-robined **across** providers (multiplies rate limits), brain model gets the brief injected → few tool round-trips. New `packages/core/src/providers/roles.ts` + `packages/core/src/agent/scout.ts`; `orchestrate` flag through contracts/server; `data-orchestration` UI chunks; `/crew` in CLI. Strictly additive — any scout failure falls back to the normal single-model turn.
6. In-progress polish (this session): CLI UX (`pcode`, alt-screen, clean exit, token %); web app redesign (model + effort/plan pickers on the composer, workspace panel — files/artifacts/todos).
7. Known small bugs: web sidebar title stays "New session" until reload (needs refetch after first reply); CLI Esc-interrupt is a stub (needs AbortController through `runAgentTurn`); CLI session persistence/resume not built yet (runs in-process, not via server).

## Repo map (what exists and works)

| Path | Contents |
|---|---|
| `packages/contracts` | Zod schemas + **full REST API contract documented at top of `src/index.ts`**. Frozen — only Dev A edits. |
| `packages/core` | `providers/providers.json` (8-provider catalog + quotas + context windows) · `providers/registry.ts` (model factory, cooldowns, fallback chain) · `providers/mock.ts` (streaming mock model) · `agent/loop.ts` (**runAgentTurn**: streaming turn w/ provider fallback + handoff brief; also `generateWithFallback`, `compareModels`) · `tools/index.ts` (bash/read/write/list/web_fetch with per-mode policy + Token Diet trimming) · `storage/sessions.ts` (JSON file-per-session store). |
| `apps/server` | Hono on **:3789**: streaming `/api/chat` (UIMessage SSE), sessions CRUD, `/api/models`, `/api/providers`, `/api/sessions/:id/usage`, `/api/compare`, share links (`POST /api/share/:id` → `/s/:id`), serves `apps/web/dist`. |
| `apps/web` | Vite+React chat: streaming `useChat`, session sidebar, model picker, mode switcher with AUTO warning. Dev B's package — spec in `apps/web/AGENTS.md`. |
| `apps/cli` | Ink TUI: streaming chat, Shift+Tab mode cycling, statusline (model · mode chip · tokens), `/mode` `/model` `/help` `/exit`. |
| `packages/channels` | `ChannelAdapter` stubs for telegram/discord/email (implementation sketches inside each file) + standalone harness. Dev C's package — spec in `packages/channels/AGENTS.md`. |

## Commands

```bash
pnpm build          # recursive topological build (contracts → core → apps)
pnpm dev:mock       # server on :3789 with mock model — NO keys needed
pnpm dev            # server with real providers from .env
pnpm dev:web        # Vite dev server :5173 (proxies /api → :3789)
pnpm dev:channels   # Dev C's adapter test harness
pnpm cli            # Ink terminal UI (real terminal required)
pnpm typecheck      # all packages
```

## Critical gotchas (learned Day 0 — do not rediscover)

- **AI SDK is v7** (`ai@^7.0.18`), NOT v5 as older plan drafts said: `convertToModelMessages()` is **async**; mocks use `MockLanguageModelV3` (`ai/test`) with **nested usage** (`inputTokens: { total, noCache, cacheRead, cacheWrite }`) and `finishReason: { unified, raw }`; high-level `totalUsage` on `streamText`/`generateText` results stays **flat** (`inputTokens/outputTokens/totalTokens`). UIMessage stream helpers (`createUIMessageStream`, `createUIMessageStreamResponse`, `toUIMessageStream({ sendStart })`, `stepCountIs`) all exist as in v5.
- **pnpm 11 does NOT auto-link workspace deps** on `pnpm add` — write `"@personacode/x": "workspace:*"` into package.json manually, then `pnpm install`. Also: new build scripts need `allowBuilds` approval in `pnpm-workspace.yaml` (esbuild already approved).
- TypeScript is v7; `tsconfig.base.json` has `"types": ["node"]`. Fallback in `agent/loop.ts` pumps `toUIMessageStream()` manually because streamText errors surface as stream `error` chunks, not thrown exceptions.
- Custom UI data parts (e.g. the fallback notice) are written as `{ type: "data-fallback", data: {...} }` chunks; web renders them in `App.tsx`.
- **Server & CLI run from source via `tsx`, but consume `@personacode/core`/`contracts` from their `dist` build.** So after editing anything in `packages/core` (loop, tools, **providers.json** catalog) you MUST `pnpm --filter @personacode/core build` for the server/CLI to see it — a `tsx` restart alone won't. Core's build script also copies `providers.json` into `dist/providers/`.
- **`.env` lives at the repo root but pnpm runs scripts with cwd = the package dir**, so `import "dotenv/config"` missed it. `apps/server/src/index.ts` and `apps/cli/src/index.tsx` now walk up ancestors to find the nearest `.env`. `dotenv` does NOT override vars already in `process.env` — handy for tests (e.g. `GOOGLE_...=bad pnpm dev` forces a fallback without touching `.env`).
- **Fallback was silently broken (fixed Day 1):** (1) `toUIMessageStream()` masks errors as "An error occurred" — pass `onError` to see the real message; (2) the handoff brief must go in the `system` option, NOT as a `role:"system"` message inside `messages` (AI SDK v7 throws `InvalidPromptError`). `shouldFallback()` in `loop.ts` now also treats 401/403/"api key not valid" as fallback-worthy.
- **Model catalog goes stale fast.** Provider model ids change monthly (Gemini 2.5→3.x, Cerebras dropped Llama, Zen retired grok-code). When a provider 404s, re-query its `/models` endpoint and refresh `providers.json`. Scratchpad has `provider-health.mjs` / `list-models.mjs` helpers from Day 1.

## Hard rules

- **Legal/naming**: use the "Ship as" names from the plan (Setup Scout, Token Diet, Terse Mode, PAV Loop, PERSONA.md, Channels, Model Crew). Never ship "Claude Code" / "Hermes" / "opencode" / "Freebuff" / "Codebuff" strings in code, UI, or branding. MIT/Apache deps only; keep attribution.
- **Provider philosophy (like OpenCode): support ANY model, free OR paid — the user chooses.** The product must let users bring paid providers / pay-as-you-go / subscription models freely, and use whatever model they want per session. We simply **default to free/cheap** models and ship every no-card free tier (Google AI Studio, Groq, Cerebras, OpenRouter `:free`, NVIDIA NIM, GitHub Models, OpenCode Zen `*-free`, Ollama local). "Zero budget" is *our hackathon* constraint, not a product limit — never hard-block paid models. (OpenCode Zen is freemium: use its `-free` models for the free path; its frontier models are pay-as-you-go and that's fine to offer.)
- **Stack is locked** (plan §2): pnpm workspaces, TypeScript, Vercel AI SDK **v7**, `@modelcontextprotocol/sdk`, Ink CLI, Hono server, Vite+React web, JSON/Markdown file storage (no native deps like better-sqlite3 — beginner teammates on Windows).
- **Contracts freeze**: `packages/contracts` is the API source of truth; Dev B and Dev C code only against it and only inside their own package.
- API keys live in `.env` (git-ignored) only; the server proxies all LLM calls; keys never reach the web client or logs.

## Team

- **Dev A** (this user, Claude Code Pro + Antigravity in parallel on disjoint dirs): core engine, contracts, CLI, server.
- **Dev B** (beginner, Antigravity IDE): `apps/web` only — spec: `apps/web/AGENTS.md`.
- **Dev C** (beginner, Antigravity IDE): `packages/channels` + cookbook backend + `docs/` only — spec: `packages/channels/AGENTS.md`.

## Environment

Node v24.16.0 · pnpm 11.10.0 · git 2.55 · Windows 11 (PowerShell + Git Bash). Claude Code extras installed: Playwright MCP, context7 MCP, Understand-Anything plugin.
