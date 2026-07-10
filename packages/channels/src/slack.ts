import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";
import { App } from "@slack/bolt";

/**
 * Slack adapter — @slack/bolt in Socket Mode (no public URL needed).
 * Tokens from env: SLACK_BOT_TOKEN + SLACK_APP_TOKEN.
 *
 * Setup:
 *   1. Create a Slack app at https://api.slack.com/apps
 *   2. Enable Socket Mode → get an App-Level Token (xapp-...)
 *   3. Add Bot Token Scopes: chat:write, channels:history, groups:history, im:history, mpim:history
 *   4. Install to workspace → get Bot User OAuth Token (xoxb-...)
 *   5. Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env
 */

let app: App | null = null;

export const slackAdapter: ChannelAdapter = {
  id: "slack",
  get available() {
    return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN);
  },

  async start(onMessage: (msg: ChannelMessage) => Promise<void>) {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!botToken || !appToken) {
      throw new Error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in .env");
    }

    try {
      app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      // Listen for all messages (channels, DMs, group DMs)
      app.message(async ({ message }) => {
        // Skip bot messages and message subtypes (edits, joins, etc.)
        if (!("text" in message) || !("user" in message) || ("bot_id" in message)) return;

        try {
          await onMessage({
            channel: "slack",
            conversationId: message.channel,
            from: message.user ?? "unknown",
            text: message.text ?? "",
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error("[slack] onMessage error:", (err as Error).message);
        }
      });

      await app.start();
      console.log("[slack] bot started (Socket Mode)");
    } catch (err) {
      console.error("[slack] start failed:", (err as Error).message);
      throw err;
    }
  },

  async send(conversationId: string, text: string) {
    if (!app) {
      throw new Error("slack adapter not started — cannot send");
    }

    try {
      await app.client.chat.postMessage({
        channel: conversationId,
        text,
      });
    } catch (err) {
      console.error("[slack] send failed:", (err as Error).message);
    }
  },

  async stop() {
    if (app) {
      await app.stop();
      app = null;
    }
    console.log("[slack] stopped");
  },
};
