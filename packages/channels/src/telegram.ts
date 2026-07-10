import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";
import { Bot } from "grammy";

/**
 * Telegram adapter — grammY long-polling bot.
 * Token from env: TELEGRAM_BOT_TOKEN (get from @BotFather).
 * No public URL needed — uses long-polling.
 */

let bot: Bot | null = null;

export const telegramAdapter: ChannelAdapter = {
  id: "telegram",
  get available() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
  },

  async start(onMessage: (msg: ChannelMessage) => Promise<void>) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN must be set in .env");
    }

    try {
      bot = new Bot(token);

      bot.on("message:text", async (ctx) => {
        try {
          await onMessage({
            channel: "telegram",
            conversationId: String(ctx.chat.id),
            from: ctx.from?.username ?? String(ctx.from?.id ?? "unknown"),
            text: ctx.message.text,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error("[telegram] onMessage error:", (err as Error).message);
        }
      });

      // Error handler — log but don't crash
      bot.catch((err) => {
        console.error("[telegram] bot error:", err.message);
      });

      // Start long-polling (non-blocking).
      // drop_pending_updates avoids processing stale messages from previous sessions.
      // The returned promise rejects if the polling loop dies (e.g. 409 conflict) —
      // catch it so it doesn't crash the process.
      bot.start({
        drop_pending_updates: true,
        onStart: () => console.log("[telegram] bot started (long-polling)"),
      }).catch((err) => {
        console.error("[telegram] polling stopped:", (err as Error).message);
      });
    } catch (err) {
      console.error("[telegram] start failed:", (err as Error).message);
      throw err;
    }
  },

  async send(conversationId: string, text: string) {
    if (!bot) {
      throw new Error("telegram adapter not started — cannot send");
    }

    try {
      // Telegram has a 4096-char message limit; split if needed
      const MAX_LEN = 4096;
      if (text.length <= MAX_LEN) {
        await bot.api.sendMessage(Number(conversationId), text);
      } else {
        // Split into chunks
        for (let i = 0; i < text.length; i += MAX_LEN) {
          await bot.api.sendMessage(Number(conversationId), text.slice(i, i + MAX_LEN));
        }
      }
    } catch (err) {
      console.error("[telegram] send failed:", (err as Error).message);
    }
  },

  async stop() {
    if (bot) {
      await bot.stop();
      bot = null;
    }
    console.log("[telegram] stopped");
  },
};

