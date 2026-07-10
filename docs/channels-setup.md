# Channel Adapter Setup Guide

Step-by-step instructions to get credentials for every PersonaCode channel adapter.
All tokens go in the repo-root `.env` file — **never commit real secrets**.

---

## Telegram

**Env var:** `TELEGRAM_BOT_TOKEN`

1. Open Telegram and search for **@BotFather** (blue tick).
2. Send `/newbot` and follow the prompts:
   - Choose a display name, e.g. `PersonaCode`
   - Choose a username ending in `bot`, e.g. `personacode_bot`
3. BotFather replies with an **HTTP API token** like `7123456789:AAF…xyz`.
4. Copy that token into your `.env`:
   ```
   TELEGRAM_BOT_TOKEN=7123456789:AAF…xyz
   ```
5. Run `pnpm dev:channels` — you should see `[telegram] bot started (long-polling)`.
6. Message your bot in Telegram → the harness echoes back a fake reply.

> **No public URL needed.** The adapter uses long-polling (`bot.start()`) — works behind NAT/firewall.

---

## Discord

**Env vars:** `DISCORD_BOT_TOKEN`

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application**.
2. Name it (e.g. `PersonaCode`), accept the terms, click **Create**.
3. In the left sidebar → **Bot** → click **Add Bot** → confirm.
4. Under **Token** click **Reset Token** → copy the token.
5. **Critical — enable the Message Content intent:**
   - Still on the Bot page, scroll to **Privileged Gateway Intents**.
   - Toggle **Message Content Intent** ON.
   - Click **Save Changes**.
6. Invite the bot to your server:
   - Left sidebar → **OAuth2 → URL Generator**.
   - Scopes: `bot`. Bot Permissions: `Send Messages`, `Read Message History`, `View Channels`.
   - Copy the generated URL → open it → pick your server → Authorise.
7. Add the token to `.env`:
   ```
   DISCORD_BOT_TOKEN=MTIz…abc
   ```
8. Run `pnpm dev:channels` — you should see `[discord] bot online as YourBot#1234`.
9. Message the bot in any channel it has access to → it echoes back.

> **No public URL needed.** The adapter uses discord.js Gateway (WebSocket), works behind NAT.

---

## Email (Gmail)

**Env vars:** `EMAIL_USER`, `EMAIL_APP_PASSWORD`, `EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST`

Gmail requires an **App Password** (not your real password) because the adapter uses IMAP + SMTP.

### Enable 2-Step Verification (required for App Passwords)
1. Go to [myaccount.google.com/security](https://myaccount.google.com/security).
2. Under **How you sign in to Google** → click **2-Step Verification** → turn it on.

### Create an App Password
1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   (only visible after enabling 2-Step Verification).
2. Select app: **Mail** · Select device: **Other (Custom name)** → type `PersonaCode` → click **Generate**.
3. Copy the 16-character password (shown once).

### Add to `.env`
```
EMAIL_USER=you@gmail.com
EMAIL_APP_PASSWORD=abcd efgh ijkl mnop
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_SMTP_HOST=smtp.gmail.com
```

4. Run `pnpm dev:channels` → `[email] IMAP connected to imap.gmail.com as you@gmail.com`.
5. Send yourself an email → the harness replies.

### Seen-UID tracking
Processed message IDs are stored in `.personacode/data/email-seen.json`.
Restarting the harness will **not** re-process already-seen mail.

> **Note:** The adapter skips `noreply`, `mailer-daemon`, `postmaster`, and `donotreply` senders automatically to prevent reply loops.

---

## Slack

**Env vars:** `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`

The adapter uses **Socket Mode** — no public URL or ngrok needed.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name it `PersonaCode`, pick your workspace → **Create App**.

### Enable Socket Mode
3. Left sidebar → **Socket Mode** → toggle **Enable Socket Mode** ON.
4. Give the token a name (e.g. `personacode-socket`) → click **Generate**.
5. Copy the **App-Level Token** (starts with `xapp-`) — this is `SLACK_APP_TOKEN`.

### Add Bot Scopes
6. Left sidebar → **OAuth & Permissions** → scroll to **Scopes → Bot Token Scopes**.
7. Add: `channels:history`, `chat:write`, `im:history`, `im:write`, `mpim:history`.

### Enable Events
8. Left sidebar → **Event Subscriptions** → toggle **Enable Events** ON.
9. Subscribe to bot events: `message.channels`, `message.im`.

### Install to Workspace
10. Left sidebar → **Install App** → **Install to Workspace** → Allow.
11. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — this is `SLACK_BOT_TOKEN`.

### Add to `.env`
```
SLACK_BOT_TOKEN=xoxb-…
SLACK_APP_TOKEN=xapp-…
```

12. Run `pnpm dev:channels` → `[slack] app started (socket mode)`.
13. DM your bot in Slack → it echoes back.

---

## Quick reference

| Channel  | Env vars needed                              | URL required? |
|----------|----------------------------------------------|---------------|
| Telegram | `TELEGRAM_BOT_TOKEN`                         | No            |
| Discord  | `DISCORD_BOT_TOKEN`                          | No            |
| Email    | `EMAIL_USER` + `EMAIL_APP_PASSWORD`          | No            |
| Slack    | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`        | No            |

All adapters self-disable gracefully if their env vars are missing — they will not crash the process.
