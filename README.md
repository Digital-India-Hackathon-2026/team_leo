# Personacode

Open-source, privacy-first agent platform: an agentic CLI **and** self-hosted web app.
Multi-provider (8 free providers with automatic fallback + context handoff), MCP, skills,
memory, agent modes, channels (Telegram / Discord / Email), checkpoints, and superagents
you build from a single prompt.

**Private by default** — runs on your machine against your own endpoints. No telemetry.

## Quick start

```bash
pnpm install
cp .env.example .env       # add any free provider keys you have (see docs/pre-hackathon-checklist.md)
pnpm build
pnpm dev                   # server + web at http://localhost:3789
pnpm cli                   # terminal UI
```

No keys yet? Run the mock mode — everything works with canned responses:

```bash
pnpm dev:mock
```

## Workspace map

| Path | What | Owner |
|---|---|---|
| `packages/contracts` | Shared types + zod schemas + API contract (**source of truth**) | Dev A |
| `packages/core` | Agent engine: providers, fallback, tools, loop, memory, skills | Dev A |
| `packages/channels` | Email / Telegram / Discord adapters | Dev C |
| `apps/server` | Hono server — API, sessions, share links, channel gateway | Dev A |
| `apps/cli` | Ink terminal UI | Dev A |
| `apps/web` | Vite + React web app | Dev B |

Read `docs/implementationplan.md` for the full plan and your package's `AGENTS.md` before coding.

## License

MIT — see [LICENSE](LICENSE). Third-party dependencies keep their own MIT/Apache licenses.
