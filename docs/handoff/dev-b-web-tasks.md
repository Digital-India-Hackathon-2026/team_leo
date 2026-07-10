# Dev B — Next tasks (apps/web) · use Antigravity

**You use Antigravity only.** Point its agent at this file + `apps/web/AGENTS.md`.
Work **only inside `apps/web/`**. Types come from `@personacode/contracts` — import,
never redefine. Branch `web`, small commits, `pnpm --filter @personacode/web typecheck`
must pass before every push. Run with `pnpm dev:mock` (terminal 1) + `pnpm dev:web` (terminal 2).

## Status: your Day 1–3 spec is essentially DONE ✅
You shipped all pages (Chat, Compare, Settings, Notes, Tasks, Gallery, Cookbook),
4 themes, markdown rendering, typewriter streaming, tool-call cards, live token
counter. Great work. The tasks below are **new / polish**, ordered by demo value.

---

## 1. ⚙ PAV Loop pipeline card (NEW — highest value) 🔴
Dev A just shipped the **PAV Loop** (Plan → Apply → Verify). The server now streams a
new data chunk type `data-pav` during a PAV run. Render it as a pipeline card, exactly
like you already render the ⚡ Crew `data-orchestration` chunk.

**Do this by mirroring existing code you already wrote:**
- In `App.tsx`, the message-parts loop already handles `part.type === "data-orchestration"`
  (~line 399, renders `<div className="chip crew">⚡ …</div>`). Add a sibling branch for
  `part.type === "data-pav"`.
- Add a **⚙ PAV** composer toggle next to the **⚡ Crew** toggle (~line 549). Same pattern:
  `const [pav, setPav] = useState(false)` and include `pav` in the `DefaultChatTransport`
  body (the `body: () => ({ sessionId, model, mode, orchestrate: crew, pav, approvals: true })`
  memo — add `pav` to it AND to the memo's dependency array).

**The `data-pav` chunk shape** (from `PavStageSchema` in contracts — import `PavStage`):
```ts
{ phase: "plan" | "apply" | "verify" | "done";
  detail: string;
  model?: string; ms?: number; iteration?: number; passed?: boolean;
  plan?: string; planPath?: string;   // plan phase: markdown + saved path
  command?: string; output?: string;  // verify phase: command + (on fail) output
}
```
**Acceptance:** with the ⚙ PAV toggle on, send a coding message → you see a pipeline:
`plan → apply #1 → verify #1 (✓/✗) → done`. Show the plan markdown (collapsible),
the verify command, and green/red state for `passed`. Test with `pnpm dev:mock` (the mock
server simulates all four phases, so no keys needed).

## 2. Render the two chunks you're currently dropping 🟠
- `data-compaction` — show a subtle inline notice "history auto-compacted to fit context".
- (You already render `data-fallback`, `data-orchestration`, `data-permission-request`.)

## 3. Share button 🟠
The server already has `POST /api/share/:id` → returns `{ url: "/s/<id>" }` (a read-only
HTML snapshot). Add a **Share** button in the chat header that POSTs, then shows/copies
the returned link. No new endpoint needed.

## 4. Notes & Tasks — verify once Dev A ships the endpoints 🟡
Your `NotesPage`/`TasksPage` already call `/api/notes` and `/api/tasks`. **Dev A is adding
those endpoints now** (they didn't exist yet — not your bug). When they land, confirm your
field names match the contract shapes and add empty/loading/error states:
- `Note = { id, title, body, createdAt, updatedAt, tags: string[] }`
- `Task = { id, title, done, createdAt, schedule?, agent? }`

## 5. Cookbook "Detect my hardware" (optional, after Dev A ships `/api/cookbook`) 🟡
Your CookbookPage is currently a static recipe list (fine). Once Dev A exposes
`GET /api/cookbook`, add a **"Detect my hardware"** button that fetches it and shows the
personalized Ollama model recommendations + `ollama pull <model>` commands it returns.

## 6. General polish 🟢
Empty/error/loading states everywhere, mobile responsive (sidebar collapse), keyboard
focus/a11y, and make the AUTO-mode amber warning chip persistent & obvious.

---
**Blocked-on-Dev-A (don't wait — do 1–3, 6 now):** `/api/notes`, `/api/tasks`, `/api/cookbook`.
**Never** edit the server or other packages, invent endpoints, or add UI libraries without asking Dev A.
