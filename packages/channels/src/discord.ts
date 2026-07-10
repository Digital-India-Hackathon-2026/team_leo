import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";

/**
 * Discord adapter — Dev C implements on Day 2 with discord.js (`pnpm add discord.js`).
 *
 * Implementation sketch:
 *   const client = new Client({ intents: [Guilds, GuildMessages, MessageContent, DirectMessages] });
 *   client.on("messageCreate", (m) => { if (!m.author.bot) onMessage({
 *     channel: "discord",
 *     conversationId: m.channelId,
 *     from: m.author.username,
 *     text: m.content,
 *     timestamp: Date.now(),
 *   }); });
 *   client.login(process.env.DISCORD_BOT_TOKEN);
 *   send = (channelId, text) => (client.channels.cache.get(channelId) as TextChannel).send(text)
 */
export const discordAdapter: ChannelAdapter = {
  id: "discord",
  available: false, // flip to true when implemented + DISCORD_BOT_TOKEN present

  async start(_onMessage: (msg: ChannelMessage) => Promise<void>) {
    throw new Error("discord adapter not implemented yet — see packages/channels/AGENTS.md");
  },

  async send(_conversationId: string, _text: string) {
    throw new Error("discord adapter not implemented yet");
  },

  async stop() {},
};
