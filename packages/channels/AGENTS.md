# packages/channels — Dev C's package (Channels + Email Assistant)

You (and your AI agent) work ONLY inside `packages/channels/` and `docs/`.
The one interface you implement is `ChannelAdapter` from `@personacode/contracts`
(read it: `packages/contracts/src/index.ts`). Do not edit other packages.

## Run it

```bash
pnpm install          # once, from repo root
pnpm dev:channels     # starts the test harness (src/harness.ts)
```

The harness starts every adapter with `available: true` and answers each inbound
message with a fake reply — you can fully test a bot WITHOUT any LLM key or the
main server. Flip your adapter's `available` flag to `true` once it works.

Credentials come from `.env` at the repo root (see `.env.example`): bot tokens,
Gmail app password. NEVER hardcode or commit them.

## Your build order

### Day 1 — Email (`src/email.ts`)
1. `pnpm add imapflow mailparser nodemailer` (run inside `packages/channels`).
2. Implement per the sketch in the file: IMAP poll for unseen mail → parse →
   `onMessage(...)`; `send()` replies over SMTP with the `In-Reply-To` header.
3. Track seen UIDs in `.personacode/data/email-seen.json` so restarts don't re-process.
4. Test: send yourself an email → harness replies to it.

### Day 2 — Telegram (`src/telegram.ts`), then Discord (`src/discord.ts`)
1. Telegram: `pnpm add grammy`, token from @BotFather. Long-polling (`bot.start()`) — no public URL needed. Sketch is in the file.
2. Discord: `pnpm add discord.js`, token from the Developer Portal (enable the *Message Content* intent!). Sketch is in the file.
3. Test each in the harness: message the bot, get the fake reply.
4. If ahead of schedule: Slack with `@slack/bolt` (Socket Mode = no public URL).

### Day 3 — Cookbook backend + docs
1. `src/cookbook.ts`: `pnpm add systeminformation` → detect RAM/CPU/GPU → filter
   a static model catalog (Dev A supplies `catalog.json` on Day 2 evening) → return
   recommendations + the `ollama pull <model>` command for each.
2. `docs/providers/*.md`: step-by-step signup guide (with screenshots) for each free
   provider in `.env.example`.

## Rules

- Adapters must never crash the process: wrap connect logic in try/catch, log, and stay down gracefully.
- `pnpm --filter @personacode/channels typecheck` must pass before every push.
- Commit small, push to branch `channels`, never to `main`.
- Anything unclear about the interface → ask Dev A; don't change `contracts`.
