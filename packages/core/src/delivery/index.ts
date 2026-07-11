import { createTransport } from "nodemailer";
import type { DeliveryChannel } from "@personacode/contracts";

/**
 * Per-agent outbound delivery. An agent (usually a scheduled one) pushes its output to
 * a Discord channel (webhook), a Telegram chat (bot token), or email. Credentials are
 * per-agent — supplied at creation and kept in the git-ignored secrets store — so one
 * deployment can drive many independent bots/mailboxes. All senders are fail-soft and
 * time-bounded; a delivery failure never throws into the scheduler.
 */
export interface DeliveryConfig {
  channel: DeliveryChannel;
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
  to?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpHost?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/** Split text into pieces no longer than `limit`, preferring to break on newlines. */
function chunk(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit; // no good break point → hard cut
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

async function deliverDiscord(webhookUrl: string, text: string): Promise<DeliveryResult> {
  if (!/^https:\/\//i.test(webhookUrl)) return { ok: false, error: "discord webhook must be an https URL" };
  for (const part of chunk(text, 1_900)) {
    const res = await postJson(webhookUrl, { content: part });
    if (!res.ok) return { ok: false, error: `discord webhook responded ${res.status}` };
  }
  return { ok: true };
}

async function deliverTelegram(botToken: string, chatId: string, text: string): Promise<DeliveryResult> {
  for (const part of chunk(text, 4_000)) {
    const res = await postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: true,
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { description?: string };
      return { ok: false, error: `telegram responded ${res.status}${detail.description ? `: ${detail.description}` : ""}` };
    }
  }
  return { ok: true };
}

async function deliverEmail(config: DeliveryConfig, text: string): Promise<DeliveryResult> {
  const user = config.smtpUser ?? process.env.EMAIL_USER;
  const pass = config.smtpPass ?? process.env.EMAIL_APP_PASSWORD;
  const host = config.smtpHost ?? process.env.EMAIL_SMTP_HOST ?? "smtp.gmail.com";
  if (!config.to) return { ok: false, error: "no recipient configured" };
  if (!user || !pass) return { ok: false, error: "no SMTP credentials (set per-agent or EMAIL_USER/EMAIL_APP_PASSWORD)" };
  const transport = createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  try {
    await transport.sendMail({
      from: user,
      to: config.to,
      subject: (text.split("\n")[0] || "Personacode agent update").slice(0, 120),
      text,
    });
  } finally {
    transport.close();
  }
  return { ok: true };
}

/** Deliver `text` via the configured channel. Fail-soft: returns {ok:false,error} on failure. */
export async function deliver(config: DeliveryConfig, text: string): Promise<DeliveryResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "nothing to deliver (empty message)" };
  try {
    switch (config.channel) {
      case "discord":
        return await deliverDiscord(config.webhookUrl ?? "", body);
      case "telegram":
        return await deliverTelegram(config.botToken ?? "", config.chatId ?? "", body);
      case "email":
        return await deliverEmail(config, body);
      default:
        return { ok: false, error: `unknown delivery channel: ${config.channel}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** A safe, non-secret one-line summary of a delivery target for the UI/logs. */
export function deliveryTargetHint(config: DeliveryConfig): string {
  switch (config.channel) {
    case "discord":
      return "discord webhook";
    case "telegram":
      return `telegram chat ${config.chatId ?? "?"}`;
    case "email":
      return config.to ?? "email";
    default:
      return config.channel;
  }
}
