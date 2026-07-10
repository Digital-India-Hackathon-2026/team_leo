import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";
import { Client, GatewayIntentBits, type TextChannel } from "discord.js";

/**
 * Discord adapter — discord.js bot with Message Content intent.
 * Token from env: DISCORD_BOT_TOKEN (from Discord Developer Portal).
 * IMPORTANT: Enable the Message Content intent in the Developer Portal!
 */

let client: Client | null = null;

export const discordAdapter: ChannelAdapter = {
  id: "discord",
  get available() {
    return Boolean(process.env.DISCORD_BOT_TOKEN);
  },

  async start(onMessage: (msg: ChannelMessage) => Promise<void>) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error("DISCORD_BOT_TOKEN must be set in .env");
    }

    try {
      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
      });

      client.on("messageCreate", async (m) => {
        // Skip bot messages (including our own)
        if (m.author.bot) return;

        try {
          await onMessage({
            channel: "discord",
            conversationId: m.channelId,
            from: m.author.username,
            text: m.content,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error("[discord] onMessage error:", (err as Error).message);
        }
      });

      client.on("error", (err) => {
        console.error("[discord] client error:", err.message);
      });

      client.once("ready", () => {
        console.log(`[discord] bot online as ${client?.user?.tag}`);
      });

      await client.login(token);
    } catch (err) {
      console.error("[discord] start failed:", (err as Error).message);
      throw err;
    }
  },

  async send(conversationId: string, text: string) {
    if (!client) {
      throw new Error("discord adapter not started — cannot send");
    }

    try {
      const channel = client.channels.cache.get(conversationId) ??
        await client.channels.fetch(conversationId);

      if (!channel || !("send" in channel)) {
        console.error(`[discord] channel ${conversationId} not found or not a text channel`);
        return;
      }

      const textChannel = channel as TextChannel;

      // Discord has a 2000-char message limit; split if needed
      const MAX_LEN = 2000;
      if (text.length <= MAX_LEN) {
        await textChannel.send(text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LEN) {
          await textChannel.send(text.slice(i, i + MAX_LEN));
        }
      }
    } catch (err) {
      console.error("[discord] send failed:", (err as Error).message);
    }
  },

  async stop() {
    if (client) {
      client.destroy();
      client = null;
    }
    console.log("[discord] stopped");
  },
};

