# Pre-Hackathon Checklist — install & sign up BEFORE Day 0

Everything below is free and needs no credit card. Already done today (2026-07-08): Node v24.16.0 ✓, pnpm 11.10.0 ✓, git 2.55 ✓.

## 1. Claude Code additions (Dev A machine — this one)

| What | Why | Command / link |
|---|---|---|
| **Playwright MCP** | Lets Claude Code drive and smoke-test the web app in a real browser (plan §7, §9) | `claude mcp add playwright -- npx "@playwright/mcp@latest"` |
| **Prettier hook** | Auto-format every file Claude edits (PostToolUse hook) | Nothing to install now — Claude sets this up in `.claude/settings.json` on Day 0 |

That's it — everything else Claude Code needs (docs lookup, security review, frontend design, verification, code review) is already installed.

## 2. Free provider API keys (get all 7, ~2 min each, save into a private note — they go in `.env` on Day 0)

| Priority | Provider | Where |
|---|---|---|
| 1 | Google AI Studio (Gemini) | https://aistudio.google.com/apikey |
| 2 | Groq | https://console.groq.com/keys |
| 3 | Cerebras | https://cloud.cerebras.ai/ |
| 4 | OpenRouter | https://openrouter.ai/keys |
| 5 | NVIDIA NIM | https://build.nvidia.com/ (API key from any model page) |
| 6 | GitHub Models | https://github.com/settings/tokens (fine-grained PAT works) |
| 7 | OpenCode Zen | https://opencode.ai/zen (rotating $0 models) |
| — | ~~Tavily~~ — no longer needed | Web search is zero-key now: `duck-duck-scrape` + Gemini Google-Search grounding (5,000 free/mo on the AI Studio key). Tavily is optional. |

## 3. Local model runtime (optional but powers the Cookbook demo + offline fallback)

- **Ollama** — https://ollama.com/download → then `ollama pull qwen3:4b` (or any small model that fits your RAM).

## 4. Integration credentials (Dev C's features — create before the event)

| What | Why | How |
|---|---|---|
| Telegram bot token | Channels demo | Message @BotFather on Telegram → `/newbot` |
| Discord bot token | Channels demo | https://discord.com/developers/applications → New Application → Bot |
| Throwaway Gmail + app password | Email Assistant testing | New Gmail → enable 2FA → myaccount.google.com/apppasswords |

## 5. Teammate machines (Dev B & Dev C)

- Node.js 22+ (https://nodejs.org), then `npm i -g pnpm`
- git + a GitHub account (repo gets created at hackathon start — no git init before)
- Antigravity IDE signed in and working

## Day 0 first command

Open Claude Code in this folder and say: **"Read CLAUDE.md and docs/implementationplan.md, then start Day 0 scaffolding."**
