# Dev B — Next tasks (apps/web) · use Antigravity

**You use Antigravity only.** Point its agent at this file + `apps/web/AGENTS.md`.
Work **only inside `apps/web/`**. Types come from `@personacode/contracts` — import,
never redefine. Branch `web`, small commits, `pnpm --filter @personacode/web typecheck`
must pass before every push. Run: `pnpm dev:mock` (terminal 1) + `pnpm dev:web` (terminal 2).

## Status: your original spec is DONE ✅ — and Dev A just shipped new backends for you
All your pages (Chat, Compare, Settings, Notes, Tasks, Gallery, Cookbook), 4 themes,
markdown, typewriter streaming, tool-cards, Pollinations image gen — done. Great work.
**Two things changed on the backend (now live on `main` after Dev A's merge):**
1. `/api/notes` + `/api/tasks` now **exist** → your Notes/Tasks pages should work end-to-end.
2. New endpoints exist with **no UI yet**: `/api/agents`, `/api/setup-scout`, `/api/cookbook`.

Tasks below are ordered by demo value.

---

## 1. ⚙ PAV Loop pipeline card (NEW chunk — highest value) 🔴
The server streams a `data-pav` chunk during a PAV run. Render it as a pipeline card, exactly
like you already render the ⚡ Crew `data-orchestration` chunk in `App.tsx` (~line 399).
- Add a branch for `part.type === "data-pav"` next to the orchestration one.
- Add a **⚙ PAV** composer toggle next to **⚡ Crew** (~line 549); include `pav` in the
  `DefaultChatTransport` body (`{ sessionId, model, mode, orchestrate: crew, pav, approvals: true }`)
  and its dependency array.
- Chunk shape (`PavStage` in contracts): `phase: "plan"|"apply"|"review"|"verify"|"done"`,
  `detail`, `model?`, `iteration?`, `passed?`, `plan?`, `planPath?`, `command?`, `output?`.
- **Acceptance (mock):** toggle ⚙ PAV on, send a coding message → see `plan → apply → review →
  verify → done`, with the plan markdown (collapsible), the verify command, and green/red `passed`.

## 2. 🤖 Superagent builder page (NEW backend) 🔴
Endpoints: `GET /api/agents` → `CreateAgentResponse[]`; `POST /api/agents` `{ prompt }` →
`{ agent, path }`. And chat can bind an agent: send `agent: "<name>"` in the chat body.
- New page/tab "Agents": a prompt box ("describe an agent…") → POST → show the generated
  `AgentDefinition` (name, systemPrompt, tools, model, mode, channels, schedule).
- List saved agents; let the user **pick one for the chat** (adds `agent` to the transport body).
- **Acceptance (mock):** type "an agent that reviews PRs for security" → an agent is created and
  appears in the list; selecting it and chatting uses it. Great "built from one prompt" demo beat.

## 3. 🔍 Setup Scout panel (NEW backend) 🟠
Endpoints: `GET /api/setup-scout` (preview) and `POST /api/setup-scout` (apply) →
`SetupScoutResponse` (`detected` languages/frameworks/scripts + `recommendations` mcpServers/
skills/personaTemplate + `applied[]`).
- A panel (in Settings or its own tab): show detected stack + recommendations, with an **Apply**
  button that POSTs and then lists what was written (PERSONA.md, mcp.json, skill).

## 4. 🍳 Cookbook "Detect my hardware" button 🟠
`GET /api/cookbook` → `{ hardware, recommendations }` (real RAM/CPU/GPU scan + Ollama picks with
`pullCommand`). Add a button on your Cookbook page that fetches it and renders the personalized
model list + copy-able `ollama pull …` commands, layered over your static recipes.

## 5. Small chunk + share polish 🟠
- Render `data-compaction` as a subtle "history auto-compacted" inline notice.
- **Share button** in the chat header → `POST /api/share/:id` → show/copy the returned `/s/<id>` link.

## 6. Verify Notes & Tasks 🟡
They now have real endpoints. Confirm your field names match the contracts and add empty/loading/
error states: `Note = { id, title, body, createdAt, updatedAt, tags[] }`,
`Task = { id, title, done, createdAt, schedule?, agent? }`.

## 7. Bharat Mode language selector (if Dev A ships it) 🟡
Dev A is planning a Digital-India **Bharat Mode** (Indic multilingual + optional voice). When the
contract adds a `language` field, add a language picker in the composer/header and (optional) a
mic button using the browser Web Speech API (free, client-side). Coordinate with Dev A first.

## 8. General polish 🟢
Empty/error/loading states, mobile responsive (collapsible sidebar), a11y, persistent amber AUTO warning.

---
**Never** edit the server or other packages, invent endpoints, or add UI libraries without asking Dev A.
