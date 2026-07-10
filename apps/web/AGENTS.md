# apps/web — Dev B's package (Personacode Web App)

You (and your AI agent) work ONLY inside `apps/web/`. Never edit other packages.
Types come from `@personacode/contracts` — import them, never redefine them.
The full API surface is documented at the top of `packages/contracts/src/index.ts`.

## Run it

```bash
pnpm install                # once, from repo root
pnpm dev:mock               # terminal 1: server with canned LLM replies (no keys needed!)
pnpm dev:web                # terminal 2: Vite dev server → http://localhost:5173
```

The Vite dev server proxies `/api/*` to the backend. `App.tsx` already has a
working streaming chat (AI SDK v5 `useChat`), session sidebar, model picker, and
mode switcher — study it before adding screens, and follow its patterns.

## Tech you use

- React 19 + TypeScript, plain CSS in `src/index.css` (CSS variables = theme tokens).
- `@ai-sdk/react` `useChat` for anything streaming. Fetch for plain REST.
- No new UI libraries without asking Dev A (bundle stays lean).

## Your build order

### Day 1
1. Polish the chat: markdown rendering for assistant messages (`react-markdown` is pre-approved), auto-scroll, message timestamps, copy button.
2. Tool-call cards: parts with `type` starting `"tool-"` render as collapsible cards showing tool name, input, output.
3. Session sidebar: delete button, relative timestamps, empty states.

### Day 2
4. **Compare view** (`/compare` route or tab): textarea + multi-select of models (`GET /api/models`) → `POST /api/compare` → side-by-side answer columns with latency + token badges.
5. **Settings page**: provider list from `GET /api/providers` — show name, badge (free/freemium/local), `configured` checkmark, `quotaNote`, and a "Get key" link (`keyUrl`). This IS the `/connect` experience on web.
6. **Usage panel**: `GET /api/sessions/:id/usage` → progress bar of `contextPercent`, totals table.
7. Mode warnings: AUTO mode must show a persistent amber warning chip (already started in `App.tsx` — make it good).

### Day 3
8. Notes & Tasks UI (`GET/POST/DELETE /api/notes`, `/api/tasks` — Dev A ships these endpoints Day 2).
9. Gallery + Cookbook screens (specs arrive Day 2 evening from Dev A).
10. Theme picker: swap the CSS variable palette; themes live in `/themes/*.json`.

## Rules

- TypeScript strict; `pnpm --filter @personacode/web typecheck` must pass before every push.
- Commit small, push to branch `web`, never to `main`.
- If the API seems wrong or missing something → tell Dev A; do NOT invent endpoints or edit the server.
- Never put API keys anywhere in this package. The server owns all secrets.
