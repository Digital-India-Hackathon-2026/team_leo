# Dev A / Codex — Next work (core · contracts · server · cli)

Hand this to Codex. It works **only** in `packages/core`, `packages/contracts`,
`apps/server`, `apps/cli` (disjoint from Dev B's `apps/web` and Dev C's
`packages/channels`+`docs`, so no merge conflicts). Branch `core` → PR to `main`.

## Where the project is (2026-07-11)
- All branches integrated into `main`: core + channels + web.
- **DONE on core** (all built, verified, security-reviewed, committed `493c0db`):
  providers+fallback+handoff, tools, modes, MCP, memory/PERSONA.md, skills, checkpoints,
  auto-compaction, slash commands, permission prompts, **Model Crew (#21)**, **PAV Loop (#10)**
  with **reviewer gate (#21)**, **Notes/Tasks (#25)** endpoints + store, **Agent Hub (#16)**
  (channels mounted, per-conversation sessions, `node-cron` scheduled agents), **Cookbook (#24)**
  endpoint, **Setup Scout (#15)**, **Superagent builder (#16)**, **Hooks (#20)**, and a
  **security pass** (`security/paths.ts` traversal/symlink guard on file tools, `web_fetch`
  SSRF guard, log redaction).
- **DONE:** `pcode --web` launches the local web app in the browser (starts the server if
  needed); `pcode --help`.

## Build gotchas (do NOT rediscover — from CLAUDE.md)
- **Server & CLI run from source via tsx but consume `@personacode/core`/`contracts` from
  their `dist`.** After editing core/contracts you MUST `pnpm --filter @personacode/core build`.
- AI SDK **v7**: system-role messages inside `messages` throw — put system text in the `system`
  option (see `pumpTurn` / handoff briefs).
- Verify everything in **mock mode** (`PERSONACODE_MOCK=1`, `pnpm dev:mock`) — no keys. Use a
  throwaway `PERSONACODE_WORKSPACE=<tmp>` for file-writing tests; the user runs :3789, so use
  another `PERSONACODE_PORT=39xx`.
- Never ship "Claude Code"/"Hermes"/"opencode"/"Freebuff"/"Codebuff". Contracts is frozen —
  keep it backward-compatible for B & C.

---

## Remaining opportunities (we have time — ordered by value)

### A. Auto-mode router (#5) 🔴 — plan feature, currently missing
Auto mode exists as a *permission* mode but does NOT classify the task and pick a model.
- Add a cheap classifier: one fast call (`modelForRole("router")`) → `{ kind: code|chat|research|
  long-context, model, mode }`. Wire into `runAgentTurn` when `mode === "auto"` (or a `route` flag):
  pick the model + preset before the brain turn; emit it as a `data-orchestration`/route stage.
- **Acceptance (mock):** in Auto mode, a "research X" prompt routes to a big-context model, a
  "fix this bug" prompt routes to a coding model — visible in the stream. Matches the demo beat
  "Auto mode picks model".

### B. `web_search` tool (#2) 🔴 — plan feature, currently missing
Only `web_fetch` exists. Add a **keyless** `web_search` builtin:
- Primary: `duck-duck-scrape` (npm, no key). Optional research-grade: Gemini Google-Search
  grounding on the existing Google key. Return top results (title/url/snippet), Token-Diet trimmed.
- Add to `buildTools` under the same per-mode policy (allowed in plan/default/auto). Update
  `BUILTIN_TOOL_NAMES` + contracts tool docs.

### C. Deep Research preset (#28) 🟠 — now trivial with Superagents
Ship a bundled `AgentDefinition` (iterative search → fetch → notes → synthesis → cited markdown
report) as a starter agent in `.personacode/agents/` (or a seed). Uses `web_search` (B) +
Cerebras/Gemini big budgets. Great standalone demo.

### D. Bharat Mode (#30, Digital-India theme) 🟠 — see implementationplan.md
Core slice: add an optional `language` to `ChatRequest` (+ session), inject a "respond in
<language>" instruction into the system prompt, and default memory/PERSONA prompts to honor it.
CLI `/lang <code>`; web gets a picker (Dev B). Optional voice is Dev B (Web Speech API). Lean on
the existing offline (Ollama) + privacy-first story as the "digital sovereignty" pillar.

### E. ACP adapter (#29) 🟡 — editor integration
Thin `apps/acp` using `@agentclientprotocol/sdk`: implement the agent side (`initialize`,
`newSession`, `prompt` → forward to the core session API, stream `sessionUpdate`s). Makes
Personacode usable inside Zed. ~Half a day.

### F. Real Terse Mode (#9) 🟢 — optional, makes the claim fully true
A toggle/flag that swaps in a compact system prompt + an "answer concisely" instruction. Today
only the minimal base prompt + terse sub-agent prompts exist (no reply-compression toggle).

### G. Distribution — opencode-style install 🔴 (product-critical, not yet built)
Personacode must install like opencode: `curl -fsSL <url> | bash` **or** `npm i -g personacode`,
then `pcode` runs from anywhere — **no repo checkout**. Today `ensureServer` spawns the server
from `apps/server/src` via tsx (repo-only); it now falls back to `dist/index.js`, but a real
global install needs packaging:
- **One publishable `personacode` package** bundling the CLI + server + built `apps/web/dist`,
  with `bin: { pcode, personacode }`. Options: bundle server into the CLI (esbuild) so there's a
  single `dist` with no workspace-path assumptions, OR publish the workspace packages together and
  have the CLI resolve `@personacode/server` from `node_modules`.
- **`ensureServer` must locate the server relative to its own installed path** (not `pnpm-workspace.yaml`),
  and run compiled JS (no `tsx` runtime dep).
- **`curl | bash` install script** (`scripts/install.sh`): detect Node, `npm i -g personacode`
  (or download a prebuilt binary via `bun build --compile`/`pkg`). Host the script free (GitHub raw / Pages).
- Runtime/user state already lives in the per-user `~/.personacode/run/` dir (PID file) — keep any
  new runtime state there, never in the repo.
- **Acceptance:** on a machine with only Node + the published package (no repo), `pcode` and
  `pcode --web` start the server and work; `pcode --stop` stops it.

## Also
- Web UI for the new backends (Superagent builder, Setup Scout, Cookbook hardware, PAV card) is
  **Dev B's task** — see `docs/handoff/dev-b-web-tasks.md`. Don't touch `apps/web`.
- Remaining Day-3: demo-script rehearsal, `pnpm audit`, and channels real-credential e2e (Dev C).

**Suggested order:** A (auto router) → B (web_search) → C (deep research) → D (Bharat Mode) →
E (ACP) → F. Verify each in mock; `pnpm build` + `pnpm typecheck` green before pushing.
