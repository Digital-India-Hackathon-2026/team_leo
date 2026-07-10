import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";

/**
 * Telegram adapter — Dev C implements on Day 2 with grammY (`pnpm add grammy`).
 *
 * Implementation sketch (see AGENTS.md for the full spec):
 *   const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
 *   bot.on("message:text", (ctx) => onMessage({
 *     channel: "telegram",
 *     conversationId: String(ctx.chat.id),
 *     from: ctx.from?.username ?? String(ctx.from?.id),
 *     text: ctx.message.text,
 *     timestamp: Date.now(),
 *   }));
 *   bot.start();               // long-polling — no public URL needed
 *   send = (chatId, text) => bot.api.sendMessage(chatId, text)
 */
export const telegramAdapter: ChannelAdapter = {
  id: "telegram",
  available: false, // flip to true when implemented + TELEGRAM_BOT_TOKEN present

  async start(_onMessage: (msg: ChannelMessage) => Promise<void>) {
    throw new Error("telegram adapter not implemented yet — see packages/channels/AGENTS.md");
  },

  async send(_conversationId: string, _text: string) {
    throw new Error("telegram adapter not implemented yet");
  },

  async stop() {},
};
