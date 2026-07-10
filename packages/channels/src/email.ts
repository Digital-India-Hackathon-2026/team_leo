import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";

/**
 * Email adapter — Dev C implements on Day 1 (the Email Assistant is built on it).
 * Deps: `pnpm add imapflow mailparser nodemailer`
 *
 * Implementation sketch:
 *   - start(): connect ImapFlow to EMAIL_IMAP_HOST with EMAIL_USER/EMAIL_APP_PASSWORD,
 *     poll INBOX every 60s for unseen mail, parse with mailparser, then call
 *     onMessage({ channel: "email", conversationId: messageId-or-threadId,
 *                 from: sender, text: subject + "\n\n" + body, timestamp })
 *   - send(): nodemailer SMTP transport → reply to the thread (In-Reply-To header).
 *   - Keep a Set of seen UIDs in .personacode/data/email-seen.json so restarts
 *     don't re-process old mail.
 */
export const emailAdapter: ChannelAdapter = {
  id: "email",
  available: false, // flip to true when implemented + EMAIL_USER/EMAIL_APP_PASSWORD present

  async start(_onMessage: (msg: ChannelMessage) => Promise<void>) {
    throw new Error("email adapter not implemented yet — see packages/channels/AGENTS.md");
  },

  async send(_conversationId: string, _text: string) {
    throw new Error("email adapter not implemented yet");
  },

  async stop() {},
};
