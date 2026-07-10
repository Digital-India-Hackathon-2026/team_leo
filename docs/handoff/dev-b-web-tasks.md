# Dev B — Next tasks (apps/web) · use Antigravity

**You use Antigravity only.** Point its agent at this file + `apps/web/AGENTS.md`.
Work **only inside `apps/web/`**. Types from `@personacode/contracts` — import, never redefine.
Branch `web`, small commits, `pnpm --filter @personacode/web typecheck` must pass before push.
Run: `pnpm dev:mock` (terminal 1) + `pnpm dev:web` (terminal 2).

## Status: you're ~done ✅ — nearly everything is shipped
Verified in the repo: all pages (Chat, Compare, Settings, Notes, Tasks, Gallery, Cookbook),
4 themes, markdown, typewriter streaming, tool-cards, **PAV pipeline card** (`PavCard`,
renders `data-pav`), **`data-compaction` notice**, **Share button** (`/api/share`),
**Cookbook "detect my hardware"** (`/api/cookbook`), Pollinations image gen, and Notes/Tasks
against the live endpoints. Excellent — that's the whole original spec **plus** the new backends.

Only two backends still have **no UI**, plus one upcoming feature. All optional-but-valuable.

---

## 1. 🤖 Superagent builder page (NEW — best demo beat) 🔴
Backend is live: `GET /api/agents` → `CreateAgentResponse[]`; `POST /api/agents` `{ prompt }` →
`{ agent, path }`. Chat can bind an agent by sending `agent: "<name>"` in the transport body.
- New tab **"Agents"**: a prompt box ("describe an agent…") → POST → render the generated
  `AgentDefinition` (name, systemPrompt, tools, model, mode, channels, schedule).
- List saved agents; let the user **select one for the chat** (adds `agent` to the transport body).
- **Acceptance (mock):** "an agent that reviews PRs for security" → it's created, appears in the
  list; selecting it + chatting uses it. This is the "built from one prompt" demo moment.

## 2. 🔍 Setup Scout panel (NEW) 🟠
Backend live: `GET /api/setup-scout` (preview), `POST /api/setup-scout` (apply) →
`SetupScoutResponse` (`detected` langs/frameworks/scripts + `recommendations` mcpServers/skills/
personaTemplate + `applied[]`). Add a panel (Settings tab or its own) that shows the detected
stack + recommendations with an **Apply** button, then lists what got written (PERSONA.md, mcp.json,
skill). Great onboarding demo.

## 3. 🇮🇳 Bharat Mode language picker (when Dev A ships it) 🟡
Dev A is adding a Digital-India **Bharat Mode**: when `ChatRequest` gains an optional `language`,
add a **language picker** (Hindi/Bengali/Tamil/Telugu/Marathi/…) on the composer that sets it, so
the agent replies in that language. Optional: a **mic + speak** button using the browser Web Speech
API (free, on-device, no key) for voice access. Coordinate with Dev A on the exact field name.

## 4. Polish 🟢
Empty/error/loading states, mobile responsive (collapsible sidebar), a11y/keyboard focus, and a
persistent amber AUTO-mode warning chip.

---
**Never** edit the server or other packages, invent endpoints, or add UI libraries without asking Dev A.
