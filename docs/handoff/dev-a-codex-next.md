# Dev A / Codex — Next work (core · contracts · server · cli)

Hand this to Codex. It works **only** in `packages/core`, `packages/contracts`,
`apps/server`, `apps/cli` (disjoint from Dev B's `apps/web` and Dev C's
`packages/channels`+`docs`, so no merge conflicts). Branch `core` → PR to `main`.

## Where the project is (2026-07-11)
- All branches integrated into `main`: core + channels + web. Dev B shipped a full web
  app; Dev C shipped all channel adapters + cookbook + 8 provider docs.
- **Done on core:** providers+fallback+handoff, tools, modes, MCP, memory/PERSONA.md,
  skills, checkpoints, auto-compaction, slash commands, permission prompts, **Model Crew**
  (#21 scout pipeline), and **PAV Loop (#10)** — Plan→Apply→Verify (`agent/pav.ts`,
  `agent/verify.ts`, shared `agent/turn.ts::pumpTurn`; `ChatRequest.pav` + `data-pav`).
- Lockfile repaired (Dev B's react-markdown/remark-gfm were missing from main's lockfile).

## Build gotchas (do NOT rediscover — from CLAUDE.md)
- **Server & CLI run from source via tsx but consume `@personacode/core`/`contracts` from
  their `dist`.** After editing core/contracts you MUST
  `pnpm --filter @personacode/core build` (and `…/contracts build`) or the server won't see it.
- AI SDK is **v7**. System-role messages inside `messages` throw `InvalidPromptError` — put
  system text in the `system` option (see how `pumpTurn` / handoff briefs do it).
- `.env` is at repo root; the server/CLI walk ancestors to find it. Test fallbacks with e.g.
  `GOOGLE_...=bad pnpm dev`.
- Verify every change in **mock mode** (`PERSONACODE_MOCK=1`, `pnpm dev:mock`) — no keys.
  Use a throwaway `PERSONACODE_WORKSPACE=<tmp>` for anything that writes files. The user runs
  a server on :3789 — pick another port (`PERSONACODE_PORT=39xx`) for tests; don't disturb it.
- Never ship the strings "Claude Code"/"Hermes"/"opencode"/"Freebuff"/"Codebuff". Contracts is
  the frozen source of truth — only Dev A edits it; keep it backward-compatible for B & C.

---

## Priority 1 — Unblock Dev B: Notes & Tasks endpoints 🔴 (small, do first)
Dev B's `NotesPage`/`TasksPage` already call these; the server never implemented them.
- Add a JSON file store (mirror `packages/core/src/storage/sessions.ts`) for notes & tasks
  under `.personacode/data/` (git-ignored).
- Server endpoints (shapes from `NoteSchema`/`TaskSchema` in contracts — already defined):
  - `GET /api/notes` · `POST /api/notes` · `PUT/PATCH /api/notes/:id` · `DELETE /api/notes/:id`
  - `GET /api/tasks` · `POST /api/tasks` · `PATCH /api/tasks/:id` (toggle `done`) · `DELETE /api/tasks/:id`
- **Acceptance:** with `pnpm dev:mock`, Dev B's Notes/Tasks pages create/list/toggle/delete
  and survive a server restart. Update the REST contract doc block at the top of contracts.

## Priority 2 — Mount channels in the server: the "Agent Hub" 🔴 (demo-critical)
Right now `apps/server` does NOT import `@personacode/channels`, so Telegram/Discord/Email
bots only echo in the standalone harness — they never reach the real agent. Wire them:
- Add `"@personacode/channels": "workspace:*"` to `apps/server/package.json`, `pnpm install`.
- On boot, import `allAdapters`, `start()` every adapter with `available === true`, and for
  each inbound `ChannelMessage`: map it to (or create) a session, run `runAgentTurn(...)`
  (collect the streamed text), then `adapter.send(conversationId, replyText)`.
- Keep it **fail-soft**: one adapter failing to start must never crash the server (Dev C's
  adapters already try/catch; wrap the hub loop too). Gate behind an env flag if you want
  (`PERSONACODE_CHANNELS=1`) so `pnpm dev` stays quiet without bot tokens.
- **Acceptance:** with a Telegram token in `.env`, message the bot → get a real LLM reply.
  Matches the demo beat "Telegram message to the agent".

## Priority 3 — `GET /api/cookbook` (wire Dev C's hardware detect) 🟠
- Import `getCookbookRecommendations` from `@personacode/channels`; expose it at
  `GET /api/cookbook` → `{ hardware, recommendations }`. Dev B adds a "Detect my hardware"
  button on the Cookbook page against it. If Dev C owes a `catalog.json`, review/supply it.

## Priority 4 — Reviewer-role gate (#21) on PAV + Model Crew 🟠
The `reviewer` role already exists (`providers/roles.ts`, prefers a different provider than
the brain). Use it: after a PAV Apply (or a Crew turn), run a quick reviewer pass that
critiques the diff/result; on PAV, feed a failing review into the next Apply iteration just
like a failed verify. Emit it as a `review` orchestration/PAV stage. Keep it opt-in/additive.

## Priority 5 — Hooks (#20) 🟠 (cheap, high CLI-parity value)
`.personacode/hooks.json`: pre/post tool-call shell hooks (format-on-edit, block dangerous
commands, notify-on-finish). One interceptor in the tool executor (`packages/core/src/tools/
index.ts`) — run matching `preToolUse` hooks before a tool (a non-zero exit blocks it),
`postToolUse` after (e.g. `prettier --write $FILE`), `onFinish` at turn end. Add `/hooks` to
the CLI to list them.

## Priority 6 — Setup Scout (#15) & Superagent builder (#16) 🟡
- **Setup Scout:** scan the repo (langs/frameworks/package.json) → recommend MCP servers,
  skills, and a PERSONA.md template → one-click apply. Reuse `agent/scout.ts`'s repo walk.
- **Superagent builder:** from one natural-language prompt, generate an `AgentDefinition`
  (`AgentDefinitionSchema` already in contracts) → save to `.personacode/agents/*.json`.
  Add `/agent new "<prompt>"` in the CLI and a `POST /api/agents` endpoint.

## Also
- **Web PAV pipeline card is Dev B's task** (documented in `docs/handoff/dev-b-web-tasks.md`);
  don't touch `apps/web`.
- Day-3 security pass (from the plan): path-traversal on all file endpoints, secrets never in
  logs/responses, tool policy per mode. Then the demo script rehearsal.

**Suggested order for Codex:** P1 (fast unblock) → P2 (demo-critical) → P3 → P5 (cheap) →
P4 → P6. Verify each in mock before pushing; `pnpm build` + `pnpm typecheck` green.
