# Personacode — 72-Hour Hackathon Implementation Plan

## Context

Personacode is an open-source, privacy-first agent platform: a Claude-Code-style CLI **and** a self-hosted web app (the "PewDiePie self-hosted AI" experience), with multi-provider LLM support, MCP, skills, memory, agent modes, and integrations. Built by a 3-person team in ~3 days for a hackathon: **Dev A (you, Claude Code Pro)** owns the core, **Dev B and Dev C (beginners, Antigravity IDE)** own isolated, spec-driven verticals. Budget: **$0 — free-forever providers only.**

**Hackathon theme — Digital India / open solutions.** Personacode is our answer: an **open-source, free-to-run, privacy-first, multilingual** AI agent any Indian dev or citizen can self-host for ₹0 — in their own language, even offline. The theme is crystallized by **Bharat Mode (#30)**: Indic vernacular + voice access on top of the existing offline (local Ollama) + data-sovereignty (self-hosted, zero telemetry) story = digital *inclusion* and *sovereignty*.

Guiding constraints:
- **72 hours** → ruthless scope triage; every feature is either *core demo*, *quick win*, or *stubbed-by-design*.
- **Zero budget** → multi-provider free tiers chained with fallback (this is also a headline feature).
- **Legal safety** → original names everywhere, no code copied from proprietary tools, only MIT/Apache dependencies with attribution kept. Check your hackathon's rules on pre-built work before building ahead of the event.
- **Beginner teammates** → they work only inside their own packages against typed contracts + mock data you hand them on Day 0, with an `AGENTS.md` in each package so Antigravity's agent has full context.

---

## 1. Naming & Legal Safety (do this first, it's cheap)

| Risky name from the idea list | Ship as |
|---|---|
| "Claude Code Setup" plugin | **Setup Scout** (project scanner → recommends MCP/skills/config) |
| "rtk (Rust Token Killer)" | **Token Diet** (tool-output filtering/truncation) |
| "Caveman Mode" | **Terse Mode** (minimal-token system prompt + compressed replies) |
| "PAUL (Plan-Apply-Unify-Loop)" | **PAV Loop** (Plan → Apply → Verify) |
| "CLAUDE.md" project file | **PERSONA.md** |
| "Hermes messaging" | **Channels** |
| Freebuff/Codebuff-style multi-model orchestration | **Model Crew** (scout → brief → brain → reviewer pipeline) |

Rules: Apache-2.0 or MIT license for Personacode itself; keep `LICENSE`/`NOTICE` attribution for every OSS dependency; never ship strings like "Claude Code", "Hermes Agent", "opencode" in UI/branding (docs may *compare* to them factually). Don't fork opencode wholesale and rename it — use libraries as building blocks instead (normal and allowed).

## 2. Tech Stack (locked)

- **Monorepo**: pnpm workspaces (plain `pnpm -r` scripts, no Turborepo needed). Node 22+, TypeScript everywhere.
- **Agent engine**: **Vercel AI SDK v7** (`ai@^7.0.18`, Apache-2.0; installed Day 0 — v7 API gotchas are logged in CLAUDE.md) — streaming, tool calling, provider abstraction. Provider catalog metadata from **models.dev** (open data, same source opencode uses).
- **MCP**: official `@modelcontextprotocol/sdk` (client, stdio + streamable HTTP transports).
- **CLI/TUI**: **Ink** (React for terminals) + `commander` for flags.
- **Server**: **Hono** (one local server = web backend + session host + share-link host + channel webhooks).
- **Web app**: **Vite + React** SPA served by the Hono server (simpler than Next.js for a local-first app; no SSR needed). Chat UI built on `@assistant-ui/react` or plain `useChat` from AI SDK.
- **Storage**: SQLite via `better-sqlite3` (sessions, notes, tasks, gallery metadata) + plain Markdown files (memory, skills, PERSONA.md) — human-readable like Claude Code.
- **Local models**: Ollama HTTP API (+ LM Studio's OpenAI-compatible endpoint as alternate).

### Repo layout
```
personacode/
├── packages/
│   ├── core/          # Dev A — agent engine, providers, tools, MCP, memory, skills, modes
│   ├── contracts/     # Dev A — shared types + zod schemas + REST/WS API contract (source of truth)
│   └── channels/      # Dev C — email + messaging adapters
├── apps/
│   ├── cli/           # Dev A — Ink TUI
│   ├── server/        # Dev A (skeleton) — Hono; mounts core + channels, serves web build
│   └── web/           # Dev B — React SPA
├── skills/            # bundled starter skills (markdown)
├── themes/            # JSON (TUI) + CSS-vars (web) theme files
└── docs/              # setup guides incl. provider onboarding
```

## 3. Free Provider Strategy (the "free forever" engine)

Configure ALL of these on Day 0 (each is no-credit-card; each key takes ~2 min). The **fallback chain** rotates through them, which multiplies free capacity and *is itself a demo feature*:

| Priority | Provider | Free tier (as of Jul 2026) | Role |
|---|---|---|---|
| 1 | **Google AI Studio** (Gemini Flash) | ~60 RPM, 1M context, free | Default brain — best free model + huge context |
| 2 | **Groq** | Fast free tier (Llama 3.3 70B, Qwen @ ~320 tok/s) | Fast short calls, Auto-mode "quick" tier, Compare |
| 3 | **Cerebras** | ~1M tokens/day free | Bulk work, Deep Research |
| 4 | **OpenRouter `:free`** | 27+ free models, 20 RPM, 50 req/day (1000/day if $10 ever bought) | Model variety, Compare feature |
| 5 | **NVIDIA NIM** (build.nvidia.com) | Free API credits, no card | Nemotron/Llama backup |
| 6 | **GitHub Models** | Free with any GitHub account | Backup + judges love it |
| 7 | **OpenCode Zen free rotation** | $0 launch-window models (rotates; e.g. Grok Code Fast) | Optional extra coding model |
| 8 | **Ollama (local)** | Unlimited, offline | Privacy mode, Cookbook feature, final fallback that never dies |

- **Fallback system** (`packages/core/src/router/fallback.ts`): on 429/quota/5xx → mark provider cooling-down → next in chain.
- **Context Switching** (`handoff.ts`): before switching, serialize a *handoff brief* — compacted conversation summary + pinned facts + files-touched list + current task state — and inject it as the first message for the new model. This prevents the duplicate-code/nonsense problem you described. (Same machinery doubles as context-rot compaction.)
- **GitHub Copilot login**: GitHub device-flow OAuth → Copilot API token (opencode-style; open implementations exist). **Stretch goal.** **ChatGPT Plus login: cut** — ToS-fragile, not worth hackathon risk.

## 4. Feature Triage

### Tier 1 — Core (Days 1–2, must demo)
1. **Agent loop** — plan → tool call → observe loop on AI SDK; streaming; multi-turn sessions.
2. **Built-in tools** — bash (with permission gate), read/write/edit, glob/grep, web fetch + search, memory read/write. Per-tool toggle. **Web search = zero-key stack**: primary `duck-duck-scrape` (npm, keyless, free); research-grade = **Gemini Google-Search grounding** (5,000 free grounded prompts/month on the AI Studio key we already have); page reading = direct fetch + `@mozilla/readability` → markdown, all local. Tavily demoted to optional config.
3. **MCP client** — add servers via `personacode mcp add` / web settings; stdio + HTTP; tool toggles.
4. **Modes** — Default / **Plan** (read-only + plan file) / **Auto** (auto-approve) / **Edit** (files-only, no bash). One permission-policy object per mode.
5. **Auto Mode router** — classify task (code/chat/research/long-context) with a cheap Groq call → pick model + agent preset + mode.
6. **Memory** — Markdown files with frontmatter + `MEMORY.md` index (proven pattern); auto-recall by embedding-free keyword match Day 1, embeddings stretch.
7. **Skills (self-evolving)** — skills = markdown files with frontmatter (name/description/instructions). `/skill new`, and after a task succeeds the agent may propose "save this as a skill" → writes the file. That's the self-evolving story.
8. **Slash commands** — `/init` (writes PERSONA.md), `/connect`, `/compact`, `/mode`, `/model`, `/mcp`, `/skills`, `/memory`, `/theme`, `/compare`, `/usage`, `/rewind`, `/crew` (Model Crew on/off), custom commands from `.personacode/commands/*.md`.
9. **Token saving** — **Token Diet** (truncate/filter tool outputs, strip lockfiles/minified code), **Terse Mode**, auto-compaction at threshold, prompt-cache-friendly message ordering.
10. **PAV Loop** — Plan mode writes plan file → Apply executes steps → Verify runs checks/tests and diffs against plan → loops on failure.
11. **Multi-session** — sessions live in the server (SQLite); CLI and web attach by session id; N sessions in parallel.
12. **Share links** — `personacode share <session>` → static JSON snapshot served at `/s/:id` by the local server (share on LAN/tunnel). Zero external service.
13. **Web app** — chat with streaming, session sidebar, model picker, tool-call visualization, mode switcher, settings (providers/MCP/tools).
14. **Compare** — one prompt → N providers in parallel → side-by-side columns. (Cheap to build on the provider registry, huge demo value.)
15. **Setup Scout** — scan repo (langs, frameworks, package.json) → recommend MCP servers, skills, PERSONA.md template → one-click apply.
16. **Superagent builder + Agent Hub** (base44 creation, Hermes-style operation) — two halves:
    - **Builder**: prompt → LLM generates an agent definition (system prompt + tool allowlist + skills + model prefs + optional channel bindings + optional cron schedule) saved to `.personacode/agents/*.md` → runnable immediately.
    - **Agent Hub (how Hermes does 24/7)**: Hermes Agent is a long-lived runtime — CLI locally, *messaging gateway* on a server, and a cron worker — so "24/7" just means the gateway process stays running where it's hosted. Ours is the same: the Hono **server daemon owns all superagents**. Each agent definition can declare channel bindings (Telegram/Discord/Email via `packages/channels`) and `node-cron` schedules; the daemon routes inbound messages to the right agent session and fires scheduled runs, with shared memory + skills. So a superagent is reachable from Discord/Telegram and works unattended **as long as the server runs**. 24/7 options (all $0): keep the PC on, an old laptop/Raspberry Pi on home wifi, or an Oracle Cloud Always-Free VM (card needed for signup verification only, never charged). Hackathon demo: laptop running `personacode serve` + a live Telegram conversation with a built-from-one-prompt agent. Note: Hermes Agent is MIT-licensed — legal to study its gateway architecture (and even adapt code with attribution), but we write our own and never use the name.
17. **`/connect` provider onboarding** (opencode-style) — `/connect` in CLI and a Connect page in web list every supported provider (free + paid, badge-labeled) with the exact URL to get a key, paste-key input, and a live test call on save. Keys go to `.env`/local config only. Data source: a static `providers.json` in `packages/core` (name, badge, key URL, base URL, models, free-tier quota metadata).
18. **Token usage HUD** — AI SDK returns `usage` per call; aggregate per message, per session, and per provider. CLI statusline shows `tokens used / context window %` live + `/usage` prints a per-provider breakdown vs known free-tier quotas (from `providers.json`); web gets a usage panel per session + a provider quota dashboard in settings. Context-window sizes come from models.dev metadata.
19. **Checkpoints & Rewind** — automatic rollback without requiring the user's project to use git: a **shadow git repo** (`GIT_DIR` under `.personacode/checkpoints/`, `--work-tree` = project root, project's own `.git` untouched). Auto-checkpoint before every Apply/file-write step; `/rewind` lists checkpoints with descriptions and restores files (conversation state kept). GitHub is never required — purely local. If the project *is* a git repo, offer "create real branch from checkpoint" as a bonus.
20. **Hooks** — `.personacode/hooks.json`: pre/post tool-call shell hooks (e.g., format-on-edit, block dangerous commands, notify on finish). Cheap to build (one interceptor in the tool executor) and closes a major CLI-parity gap.
21. **Model Crew (multi-model orchestration)** — the Freebuff/Codebuff speed pattern ("5–10× faster" claims come from this): role-specialized models instead of one model doing everything.
    - **Roles** (`packages/core/src/providers/roles.ts`, `modelForRole(role)` over the existing catalog + cooldowns): **scout** — fastest tiny model (Gemini Flash Lite / Groq Llama-8B) scans a locally-built repo file tree (zero-LLM walk, ~400 entries, skip node_modules/dist) and picks ≤12 relevant files in ONE call; **summarizer** — briefs the picked files **in parallel** (Token-Diet-trimmed; files ≤2 KB pass verbatim); **brain** — the user-selected strong model plans/edits with the brief pre-injected as a system message, so it skips most slow read_file round-trips; **reviewer** — quality gate for PAV Verify (prefer a different provider than brain); **router** — Auto-mode classification (#5, same machinery). Per-provider `"fast"` model hint added to `providers.json`; env overrides `PERSONACODE_MODEL_SCOUT` etc.
    - **Pipeline** (`packages/core/src/agent/scout.ts`, wired into `runAgentTurn` behind an `orchestrate` flag): streams `data-orchestration` chunks (stage · model · ms) → pipeline card in web, dim stage lines + ⚡ statusline chip in CLI (`/crew on|off`). Strictly additive — scout failure or non-code task (keyword heuristic) → normal single-model turn. Mock mode emits simulated stages so Dev B builds the UI on `pnpm dev:mock`.
    - **Personacode twist**: parallel steps round-robin across *different* free providers (`nextParallelRef()`), so orchestration **multiplies free-tier rate limits** instead of draining one provider. Crew calls are metered into `/usage` like everything else. Demo beat: *"three free providers working one prompt at once — context gathered in seconds."*

### CLI UX spec (familiar Claude-Code feel, Personacode twist)
- **Layout (Ink)**: transcript pane → input box with `❯` prompt → statusline (cwd · git branch · model · **mode chip** · tokens used/ctx %). Personacode twist: gradient accent color from active theme + persona name in the header.
- **Shortcuts (Win/Mac)**: `Shift+Tab` cycle modes (Default → Auto → Plan), `Esc` interrupt agent, `Esc Esc` rewind picker, `Ctrl+C` exit, `Ctrl+L` clear screen, `↑/↓` input history, `Ctrl+O` toggle verbose tool output, `Tab` complete slash commands/paths. All handled via Ink `useInput` (identical on Windows/macOS).
- **Mode warnings**: entering **Auto mode** shows a one-time confirm + persistent red/amber banner chip `⚠ AUTO — runs commands without asking` in the statusline; **Plan mode** shows a dim `⏸ PLAN — read-only` chip; **Edit mode** shows `✎ EDIT — files only, no shell`. Permission prompts (y/n/always) appear inline for bash/write in Default mode.

### Tier 2 — Integrations (Dev B/C in parallel, Days 1–3)
22. **Email Assistant** — `imapflow` + `nodemailer` + `mailparser`; summaries, style-matched drafts, tagging, spam triage. Test against a throwaway Gmail (app password).
23. **Channels** — one `ChannelAdapter` interface for all 8; **fully implement Telegram + Discord + Email** (free, instant bot tokens), **Slack if time**; WhatsApp/SMS/Teams/Google Chat ship as typed stubs marked "coming soon" (they need Meta approval / paid Twilio / workspace admin — not doable free in 3 days). Demo line: "8 channels by design, 3-4 live."
24. **Cookbook** — detect hardware (`systeminformation`: RAM/VRAM/CPU) → filter models.dev + Ollama catalog (~270+ entries) → recommend + one-click `ollama pull` + serve. 
25. **Notes & Tasks** — SQLite CRUD + web UI; scheduled agents via `node-cron` that run a session and write a briefing note.
26. **Image Gallery** — generation via **Pollinations.ai** (free, keyless) and/or Gemini image API free tier; background removal with `@imgly/background-removal` (runs client-side, free); basic inpaint brush → API. Gallery stored locally.
27. **Themes** — JSON tokens → TUI colors + web CSS variables; "ask the agent to make a theme" = agent writes a theme JSON via a skill.
28. **Deep Research** — an agent preset: iterative search → fetch → note-taking → synthesis → markdown report with citations. Runs on Cerebras/Gemini (big free token budgets).
29. **ACP support (Agent Client Protocol)** — thin `apps/acp` adapter using the official `@agentclientprotocol/sdk` (Zed's TS library): implement the agent side (`initialize`, `newSession`, `prompt` → forward to core session API, stream `sessionUpdate`s back). Makes Personacode usable inside Zed and any ACP-capable editor. ~Half a day for Dev A on Day 3 **if** Tier 1 is done; otherwise first post-hackathon item.

### Digital India theme — Bharat Mode
30. **Bharat Mode (Digital-India / open-solutions centerpiece)** — turns Personacode into a *vernacular, inclusive, sovereign* AI agent for India. Four parts, all $0:
    - **Indic multilingual** (core + web): a language selector (Hindi, Bengali, Tamil, Telugu, Marathi, Kannada, Gujarati, …) → the agent understands and **responds / plans / comments in the chosen language**, reusing the free multilingual models we already ship (Gemini & Llama handle 20+ Indian languages). One optional `language` field on `ChatRequest` + session → a "respond in <language>" instruction injected into the system prompt (PERSONA.md/memory honored). CLI `/lang <code>`, web picker on the composer. **Low effort, high demo value** — "ask it in Hindi, it edits code and replies in Hindi."
    - **Voice I/O (accessibility)** (web-only): optional mic + speak buttons via the browser **Web Speech API** (free, on-device, no key) for hands-free / low-literacy access. Pure `apps/web`, no backend.
    - **Digital-sovereignty pillar** (already built — just frame it): runs fully **offline** via local Ollama and **privacy-first** (self-hosted, nothing leaves the device, zero telemetry). The pitch: "an open solution any Indian citizen/dev can self-host for ₹0, in their own language, even without internet."
    - **Stretch (on-theme, post-hackathon)**: **Bhashini** (India's national translation/ASR API) as an alternate language provider; an **India-Stack / DPI MCP** (DigiLocker/UPI sandbox) as a demo skill. Both need API access → not in the 72h.
    - Owners: core `language` plumbing = Dev A; language picker + voice = Dev B; framing/docs = Dev C. Legal/naming: "Bharat Mode" is an original name; no third-party branding.

### Tier 3 — Stretch / post-hackathon
- LSP integration (start `typescript-language-server`/`pyright` if found; feed diagnostics to the agent after edits) — valuable but heavy; only if Day 3 is smooth.
- Copilot login, embeddings-based memory recall, session sharing via tunnel, WhatsApp/SMS/Teams/GChat adapters, sandboxed bash.

## 5. Team Assignments

### Dev A — YOU (Claude Code Pro): Core Engine + CLI + Server skeleton
The hardest, most interconnected work — right place for Claude Code.
- Day 0: scaffold monorepo; write `packages/contracts` (zod schemas + REST/WS API for sessions, messages, models, tools, notes, gallery, email); mock server (`--mock` flag returning canned streams) so B & C never wait on you; `.env.example`; collect all 7 provider keys; write each package's `AGENTS.md` + spec.
- Days 1–2: agent loop, provider registry + fallback + handoff, tools, MCP, modes, memory, skills, slash commands (`/connect`, `/usage`, `/rewind`, …), Token Diet/Terse/compaction, PAV loop, Auto router, **Model Crew roles + scout pipeline (#21)**, sessions/share endpoints, checkpoints (shadow git), hooks, token-usage tracking, Ink TUI per the CLI UX spec.
- Day 3: Superagent builder, Setup Scout, integration glue, security pass, demo script; ACP adapter (#29) only if everything above is green.

### Dev B (Antigravity, beginner): Web App (`apps/web`)
Pure frontend against the contract + mock server. Zero knowledge of core internals needed.
- Day 1: app shell, chat page w/ streaming (AI SDK `useChat` against mock), session sidebar, theme system.
- Day 2: model picker, mode switcher, tool-call cards, settings pages (providers/MCP/tool toggles), Compare view.
- Day 3: Gallery UI, Notes & Tasks UI, Cookbook UI, polish + dark mode.
- Setup steps for B: install Node 22 + pnpm → `git clone` → `pnpm i` → `pnpm dev:mock` → open `apps/web/AGENTS.md` and `packages/contracts/` in Antigravity → build screen-by-screen from the spec. Never edits files outside `apps/web`.

### Dev C (Antigravity, beginner): Integrations (`packages/channels` + cookbook backend + docs)
Isolated adapters, each testable standalone with a script.
- Day 1: Email assistant (IMAP read → summarize via provided `llm()` helper → draft via SMTP).
- Day 2: Telegram bot (grammY) + Discord bot (discord.js) implementing `ChannelAdapter`; Slack (Bolt) if ahead.
- Day 3: Cookbook backend (hardware detect + catalog + Ollama commands), `docs/` provider-onboarding guides (step-by-step with screenshots for each free provider), stub adapters for the other 4 channels.
- Setup steps for C: same clone/install → `pnpm dev:channels` test harness → each adapter has its own `AGENTS.md` spec with the exact interface to implement + a fake-LLM helper so no keys are needed to start. Never edits files outside `packages/channels` + `docs/`.

**Integration protocol**: `packages/contracts` is frozen by Dev A; B and C code only against it; short merge sync 2× per day; Dev A resolves all cross-package wiring.

### Collaboration workflow (Antigravity + Claude Code, 3 machines)
- **At hackathon start**: Dev A runs `git init`, pushes to a **private GitHub repo**, invites B & C as collaborators. Teammates `git clone` — that's their whole setup beyond Node/pnpm.
- **Branching**: `main` is protected in practice (only Dev A merges). B works on branch `web`, C on branch `channels`, A on `core`. Because each dev owns disjoint directories, merge conflicts are near-zero by construction.
- **Cadence**: B & C push small commits often; 2× a day Dev A pulls their branches, merges to `main`, runs the build, and fixes any cross-package glue with Claude Code. B & C then `git pull origin main` into their branch.
- **Antigravity does the heavy lifting for B & C**: each package's `AGENTS.md` (written by Dev A on Day 0) is the spec Antigravity's agent reads automatically — B & C mostly prompt Antigravity screen-by-screen / adapter-by-adapter and test against the mock server. Simple git cheat-sheet goes in `docs/git-basics.md` (clone → branch → add/commit → push → pull).
- **Dev A's combo (Claude Code + Antigravity in parallel)**: two agent sessions, one machine, split by ownership so they never touch the same files:
  - **Claude Code** (this setup): `packages/core`, `packages/contracts`, `apps/server` — the deeply interconnected logic where planning/verification matters most.
  - **Antigravity (Claude Opus)**: `apps/cli` UI shell against the frozen contracts, plus data/content work — `providers.json` entries, bundled skills, themes, `docs/`.
  - Discipline: work in the same clone but disjoint directories (or `git worktree add ../pc-cli cli` for full isolation); commit small and often; when a contracts change is needed, ONLY Claude Code makes it, then the Antigravity session pulls. This roughly doubles Dev A throughput on Days 1–2.

## 6. Security & Quality (Day 3 checklist, ~half a day)
- API keys: `.env` only (git-ignored), never logged; regex secret-redaction on every log line and every share-link snapshot; keys never sent to the web client (server proxies all LLM calls).
- Permission gates on bash/write/network per mode; deny-by-default for MCP tools until toggled on.
- Agent-loop guards: max-iterations cap, repeated-identical-tool-call detector, cost/token budget per session (prevents "agent type looping").
- `pnpm audit` + `knip` (dead code) pass; run my `/security-review` and VibeSec skill over the final tree.
- Privacy default: telemetry = none, external calls only to user-configured providers (this is a headline slide).

## 7. Your Claude Code Setup for This Build (Dev A)
- **MCP**: context7 (already installed — use for AI SDK v7 / Hono / Ink docs, they change fast); **Playwright MCP** to drive/test the web app; `gh` CLI for repo ops (no MCP needed).
- **Skills to lean on**: `frontend-design` (web polish), `verify` (before each merge sync), `code-review` (end of each day), `security-review` (Day 3), this plan via Plan Mode for each big module.
- **Hooks**: PostToolUse hook running `prettier --write` on edited files; optional Stop-hook notification.
- **Project files**: root `CLAUDE.md` (for your Claude Code) + per-package `AGENTS.md` (for teammates' Antigravity) — same content, two filenames.
- Use **Plan Mode** for each Tier-1 module and **worktrees/parallel sessions** for independent modules (e.g., MCP client while tools bake).

## 7b. Claude-Code-CLI feature parity (honest coverage map)

| Claude Code feature | Personacode | How |
|---|---|---|
| Interactive TUI chat | ✅ Tier 1 | Ink, CLI UX spec above |
| Modes (default/plan/auto-accept) + warnings | ✅ Tier 1 | #4 + CLI UX spec (`Shift+Tab`, banners) |
| Slash commands + custom commands | ✅ Tier 1 | #8 |
| MCP servers (stdio/HTTP) | ✅ Tier 1 | #3 |
| Memory files (CLAUDE.md‑style) | ✅ Tier 1 | PERSONA.md + memory dir (#6) |
| Skills | ✅ Tier 1 | #7, self-evolving |
| Subagents / custom agents | ✅ Tier 1 | agent presets + Superagent builder (#16) |
| Hooks | ✅ Tier 1 | #20, `.personacode/hooks.json` |
| Checkpoints / rewind | ✅ Tier 1 | #19 shadow git |
| `/init` codebase file | ✅ Tier 1 | writes PERSONA.md |
| Token/context visibility | ✅ Tier 1 | #18 (better than CC: per-provider quota view) |
| Web + share links + multi-session | ✅ Tier 1 | #11–13 (CC needs cloud for this; ours is local) |
| Multi-provider + fallback | ✅ Tier 1 | CC doesn't have this — our headline |
| Multi-model orchestration (Freebuff-style speed) | ✅ Tier 1 | #21 Model Crew — CC doesn't have this either; ours parallelizes across free providers |
| ACP editor integration | 🟡 Tier 2 | #29 |
| LSP diagnostics | 🟡 Tier 3 | stretch |
| Bash sandboxing (OS-level) | ❌ post-hackathon | permission gates only for now |
| IDE extensions, vim mode, cloud/background agents | ❌ post-hackathon | out of 72h scope |

## 8. Day-by-Day Timeline
- **Day 0 (prep, if hackathon rules allow)**: monorepo scaffold, contracts, mock server, provider keys, AGENTS.md specs, teammates' environments verified working (`pnpm dev:mock` renders chat page).
- **Day 1**: A: agent loop + tools + providers + fallback + CLI chat working. B: chat UI streaming on mock. C: email assistant reading + summarizing a real inbox.
- **Day 2**: A: MCP, modes, memory, skills, slash commands, token saving, **Model Crew orchestration**, multi-session, share. B: settings, compare, tool-cards, model picker, orchestration pipeline card. C: Telegram + Discord live. Evening: first full integration on real server.
- **Day 3 morning**: A: Auto mode, Superagent builder, Setup Scout, PAV loop polish. B: gallery/notes/cookbook UI. C: cookbook backend + docs + stubs.
- **Day 3 afternoon**: security checklist, bug bash, demo script: *cold open on web chat → Auto mode picks model → Model Crew gathers context in seconds across three free providers → agent edits code with PAV loop → kill provider key live to show fallback+handoff → Compare view → Telegram message to the agent → superagent built from one prompt → local Ollama offline mode.*

## 9. Verification
- Core: `pnpm test` (vitest) on router/fallback/handoff/compaction units; scripted e2e — run `personacode` in a temp dir, issue a task, assert file edits + session persisted.
- Web: Playwright MCP smoke — send message, see stream, switch model, run Compare.
- Fallback demo test: set an invalid Gemini key → assert auto-switch to Groq with handoff brief injected and no duplicated output.
- Model Crew test: ask "explain how fallback works in loop.ts" with Crew on → scout picks files, brief injected, brain answers with zero/few read_file calls; compare wall-clock vs Crew off. Kill the scout provider's key → pipeline falls back; total scout failure → turn still completes normally (additive-only guarantee).
- Channels: send a real Telegram/Discord/email message → assert agent reply round-trips.
- Security: grep built artifacts + share snapshots for key patterns; confirm `.env` untracked; `pnpm audit` clean.
