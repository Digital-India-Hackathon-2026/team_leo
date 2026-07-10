import type { ChannelAdapter, ChannelMessage } from "@personacode/contracts";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport, type Transporter } from "nodemailer";
import { join } from "node:path";
import { SeenStore } from "./utils/seen-store.js";

/**
 * Email adapter — IMAP polling for inbound mail, SMTP for outbound replies.
 *
 * Credentials from env: EMAIL_IMAP_HOST, EMAIL_SMTP_HOST, EMAIL_USER, EMAIL_APP_PASSWORD.
 * Seen UIDs persisted in .personacode/data/email-seen.json so restarts don't re-process.
 */

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/** Maps conversationId (messageId) → sender email for reply addressing. */
const replyMap = new Map<string, string>();

let imapClient: ImapFlow | null = null;
let smtpTransport: Transporter | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function getConfig() {
  return {
    imapHost: process.env.EMAIL_IMAP_HOST ?? "imap.gmail.com",
    smtpHost: process.env.EMAIL_SMTP_HOST ?? "smtp.gmail.com",
    user: process.env.EMAIL_USER ?? "",
    pass: process.env.EMAIL_APP_PASSWORD ?? "",
  };
}

async function pollInbox(onMessage: (msg: ChannelMessage) => Promise<void>, seen: SeenStore) {
  if (!imapClient) return;

  try {
    const lock = await imapClient.getMailboxLock("INBOX");
    try {
      // Search for unseen messages
      const searchResult = await imapClient.search({ seen: false }, { uid: true });
      if (!searchResult || !Array.isArray(searchResult) || searchResult.length === 0) return;
      const uids: number[] = searchResult;

      for (const uid of uids) {
        const uidStr = String(uid);
        if (seen.has(uidStr)) continue;

        try {
          const fetchResult = await imapClient.fetchOne(uid, { source: true }, { uid: true });
          if (!fetchResult || !fetchResult.source) {
            seen.add(uidStr);
            continue;
          }

          const parsed = await simpleParser(fetchResult.source);
          const from = parsed.from?.value?.[0]?.address ?? "unknown";

          // Skip no-reply / bounce / automated senders to prevent infinite loops
          const fromLower = from.toLowerCase();
          if (
            fromLower === "unknown" ||
            fromLower.includes("noreply") ||
            fromLower.includes("no-reply") ||
            fromLower.includes("mailer-daemon") ||
            fromLower.includes("postmaster") ||
            fromLower.startsWith("donotreply")
          ) {
            seen.add(uidStr);
            continue;
          }

          const subject = parsed.subject ?? "(no subject)";
          const body = parsed.text ?? "";
          const messageId = parsed.messageId ?? `uid-${uid}`;
          // Use inReplyTo for threading, fallback to messageId
          const conversationId = parsed.inReplyTo ?? messageId;

          // Store sender for reply routing
          replyMap.set(conversationId, from);
          // Also map the messageId itself in case a future reply references it
          if (messageId !== conversationId) {
            replyMap.set(messageId, from);
          }

          await onMessage({
            channel: "email",
            conversationId,
            from,
            text: `${subject}\n\n${body}`.trim(),
            timestamp: Date.now(),
          });

          seen.add(uidStr);
        } catch (err) {
          console.error(`[email] failed to process UID ${uid}:`, (err as Error).message);
          seen.add(uidStr); // skip broken messages to avoid infinite retries
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error("[email] poll error:", (err as Error).message);
  }
}

export const emailAdapter: ChannelAdapter = {
  id: "email",
  get available() {
    return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
  },

  async start(onMessage: (msg: ChannelMessage) => Promise<void>) {
    const cfg = getConfig();
    if (!cfg.user || !cfg.pass) {
      throw new Error("EMAIL_USER and EMAIL_APP_PASSWORD must be set in .env");
    }

    const seenStorePath = join(process.cwd(), ".personacode", "data", "email-seen.json");
    const seen = new SeenStore(seenStorePath);

    try {
      // Connect IMAP
      imapClient = new ImapFlow({
        host: cfg.imapHost,
        port: 993,
        secure: true,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
      });

      // CRITICAL: catch 'error' events to prevent process crash (EADDRNOTAVAIL, ECONNRESET, etc.)
      imapClient.on("error", (err: Error) => {
        console.error("[email] IMAP connection error:", err.message);
      });

      // Handle unexpected disconnects gracefully — stop polling, clean up
      imapClient.on("close", () => {
        console.warn("[email] IMAP connection closed unexpectedly");
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        imapClient = null;
      });

      await imapClient.connect();
      console.log(`[email] IMAP connected to ${cfg.imapHost} as ${cfg.user}`);

      // Set up SMTP transport
      smtpTransport = createTransport({
        host: cfg.smtpHost,
        port: 587,
        secure: false,
        auth: { user: cfg.user, pass: cfg.pass },
      });

      // Initial poll
      await pollInbox(onMessage, seen);

      // Recurring poll
      pollTimer = setInterval(() => {
        pollInbox(onMessage, seen).catch((err) =>
          console.error("[email] poll interval error:", (err as Error).message)
        );
      }, POLL_INTERVAL_MS);

      console.log(`[email] polling INBOX every ${POLL_INTERVAL_MS / 1000}s`);
    } catch (err) {
      console.error("[email] start failed:", (err as Error).message);
      throw err;
    }
  },

  async send(conversationId: string, text: string) {
    if (!smtpTransport) {
      throw new Error("email adapter not started — cannot send");
    }

    const cfg = getConfig();
    const to = replyMap.get(conversationId);
    if (!to) {
      console.error(`[email] no sender found for conversationId: ${conversationId}`);
      return;
    }

    try {
      await smtpTransport.sendMail({
        from: cfg.user,
        to,
        subject: "Re: Your message",
        text,
        inReplyTo: conversationId,
        references: conversationId,
      });
      console.log(`[email] replied to ${to} (thread: ${conversationId.slice(0, 40)}…)`);
    } catch (err) {
      console.error("[email] send failed:", (err as Error).message);
    }
  },

  async stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (imapClient) {
      try {
        await imapClient.logout();
      } catch {
        // ignore close errors
      }
      imapClient = null;
    }
    if (smtpTransport) {
      smtpTransport.close();
      smtpTransport = null;
    }
    console.log("[email] stopped");
  },
};
