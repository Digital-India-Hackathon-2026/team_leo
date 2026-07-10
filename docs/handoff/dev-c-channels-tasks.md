# Dev C — Next tasks (packages/channels + docs) · use Antigravity

**You use Antigravity only.** Point its agent at this file + `packages/channels/AGENTS.md`.
Work **only inside `packages/channels/` and `docs/`**. Implement the `ChannelAdapter`
interface from `@personacode/contracts` — never edit other packages. Branch `channels`,
small commits, `pnpm --filter @personacode/channels typecheck` must pass before every push.
Test with `pnpm dev:channels` (the harness — no LLM key or main server needed).

## Status: your adapters + docs are essentially DONE ✅
You implemented all four adapters (email, telegram, discord, slack), the cookbook
hardware-detector, and 8 provider onboarding docs. Adapters correctly self-gate on
`available` (true only when their credentials are in `.env`). Great work. What's left is
**real-credential testing, screenshots, and making the cookbook catalog solid** — plus
end-to-end testing once Dev A wires channels into the server (that part is Dev A's job).

---

## 1. Real-credential test each adapter 🔴
For each of email / telegram / discord / slack: put real creds in the repo-root `.env`
(see `.env.example`), run `pnpm dev:channels`, message the bot, confirm the harness echoes
a reply. Fix any connect/parse bugs you hit. **Requirement from your spec: an adapter must
never crash the process** — wrap connect logic in try/catch, log, and stay down gracefully.
- Telegram: token from @BotFather (long-polling, no public URL).
- Discord: token from Developer Portal — **enable the Message Content intent**.
- Email: Gmail app password; verify seen-UID tracking in `.personacode/data/email-seen.json`
  survives a restart (no re-processing old mail).
- Slack: `@slack/bolt` Socket Mode (no public URL).
- **Deliverable:** a short `docs/channels-setup.md` — how to get each token/credential,
  step by step (this is the channels equivalent of your provider guides).

## 2. Add screenshots to the provider docs 🟠
Your `docs/providers/*.md` (google, groq, cerebras, openrouter, nvidia, github, zen, ollama)
are written but your spec asks for **step-by-step with screenshots**. Add screenshots of
each signup / key-copy screen. Also add `docs/providers/README.md` — a one-page index table
(provider · badge free/freemium/local · "get key" link · quota note).

## 3. Solidify the cookbook model catalog 🟠
Dev A will expose your `getCookbookRecommendations()` via a new `GET /api/cookbook` endpoint,
so its return shape must be stable. In `src/cookbook.ts`:
- Make sure `detectHardware()` + `getCookbookRecommendations()` return well-typed
  `CookbookResult` / `ModelRecommendation` / `HardwareInfo` (already exported from `index.ts`).
- Ship a solid static model catalog inside the package (RAM tier → recommended Ollama models
  + the `ollama pull <model>` command). If Dev A hasn't given you a `catalog.json`, draft one
  yourself (small local models: `llama3.2:1b/3b`, `qwen3:4b`, `phi`, etc.) and Dev A will review.
- **Acceptance:** calling `getCookbookRecommendations()` on your machine returns sensible
  picks for your actual RAM/GPU with copy-paste pull commands.

## 4. Help test channels end-to-end (after Dev A mounts them) 🟡
Dev A is adding the **Agent Hub** wiring in the server (start `available` adapters → route
inbound messages to a real agent session → send the reply back). Once that lands, retest
your bots against the *real* server (`pnpm dev`) instead of the harness, and confirm a real
LLM reply comes back on Telegram/Discord/email. Report anything that breaks to Dev A.

## 5. Keep the 4 stub channels as stubs 🟢
whatsapp / sms / googlechat / teams stay `available: false` `stubAdapter(...)` — correct for
the hackathon. No work needed unless you're far ahead.

---
**Not your job (Dev A owns it):** mounting channels in `apps/server`, the `/api/cookbook`
endpoint, the `catalog.json` review. **Never** commit secrets — the server owns all keys;
your adapters read them from `process.env` only.
