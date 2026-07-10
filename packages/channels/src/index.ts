/**
 * @personacode/channels — Dev C's package.
 *
 * Every channel implements the ChannelAdapter interface from @personacode/contracts.
 * The server (Agent Hub) starts every adapter whose `available` is true and
 * routes inbound ChannelMessages to agent sessions.
 *
 * Day 1-3 order (see AGENTS.md): email → telegram → discord → slack (if ahead).
 * WhatsApp / SMS / Google Chat / Teams stay `available: false` stubs for the hackathon.
 */
import type { ChannelAdapter } from "@personacode/contracts";
import { telegramAdapter } from "./telegram.js";
import { discordAdapter } from "./discord.js";
import { emailAdapter } from "./email.js";
import { stubAdapter } from "./stub.js";

export const allAdapters: ChannelAdapter[] = [
  telegramAdapter,
  discordAdapter,
  emailAdapter,
  stubAdapter("slack"),
  stubAdapter("whatsapp"),
  stubAdapter("sms"),
  stubAdapter("googlechat"),
  stubAdapter("teams"),
];

export { telegramAdapter, discordAdapter, emailAdapter, stubAdapter };
