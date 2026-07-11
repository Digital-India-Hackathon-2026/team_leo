import { tool } from "ai";
import { createTransport } from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ToolSet } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { lookup } from "node:dns/promises";
import { BlockList, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Mode } from "@personacode/contracts";
import { runToolHooks } from "../hooks/index.js";
import { resolveWorkspacePath } from "../security/paths.js";

const execAsync = promisify(exec);

/** Token Diet: cap tool output so one noisy command can't torch the context. */
const MAX_TOOL_OUTPUT = 8_000;
function diet(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT / 2) +
    `\n… [Token Diet: ${s.length - MAX_TOOL_OUTPUT} chars trimmed] …\n` +
    s.slice(-MAX_TOOL_OUTPUT / 2)
  );
}

export interface ToolPolicy {
  mode: Mode;
  /** project root the agent operates in */
  cwd: string;
  /** names disabled via per-tool toggles */
  disabled: Set<string>;
  /**
   * Optional gate for side-effecting tools (bash/write_file) in Default mode.
   * Resolves true to run, false to skip. Wired by the host (server) to prompt the
   * user y/n/always; absent (CLI in-process, tests) means auto-allow.
   */
  requestApproval?: (info: { tool: string; input: unknown }) => Promise<boolean>;
}

/** Side-effecting tools that require confirmation in Default mode. */
const NEEDS_APPROVAL = new Set(["bash", "write_file"]);

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as Array<[string, number]>) blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as Array<[string, number]>) blockedAddresses.addSubnet(network, prefix, "ipv6");

function blockedAddress(address: string, family: number): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blockedAddresses.check(mapped[1]!, "ipv4");
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

async function publicEndpoint(value: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only HTTP(S) URLs are allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("local URLs are not allowed");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.some(({ address, family }) => blockedAddress(address, family))) {
    throw new Error("private-network URLs are not allowed");
  }
  const selected = addresses[0];
  if (!selected) throw new Error("host did not resolve");
  return { url, address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

async function fetchPublicText(value: string): Promise<string> {
  let current = new URL(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const endpoint = await publicEndpoint(current.href);
    const response = await new Promise<{ status: number; location?: string; text: string }>((resolve, reject) => {
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: endpoint.address, family: endpoint.family }]);
        else callback(null, endpoint.address, endpoint.family);
      };
      let request: ReturnType<typeof httpRequest>;
      const deadline = setTimeout(() => request?.destroy(new Error("request timed out")), 15_000);
      const succeed = (value: { status: number; location?: string; text: string }) => {
        clearTimeout(deadline);
        resolve(value);
      };
      const fail = (error: Error) => {
        clearTimeout(deadline);
        reject(error);
      };
      request = (current.protocol === "https:" ? httpsRequest : httpRequest)(
        current,
        {
          lookup: pinnedLookup,
          headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
        },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          const location = incoming.headers.location;
          if (status >= 300 && status < 400) {
            incoming.resume();
            succeed({ status, location, text: "" });
            return;
          }
          const declared = Number(incoming.headers["content-length"] ?? 0);
          if (declared > 2_000_000) {
            incoming.destroy();
            fail(new Error("response is too large"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          incoming.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 2_000_000) incoming.destroy(new Error("response is too large"));
            else chunks.push(chunk);
          });
          incoming.on("end", () => succeed({ status, location, text: Buffer.concat(chunks).toString("utf8") }));
          incoming.on("error", fail);
        },
      );
      request.on("error", fail);
      request.end();
    });
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error(`HTTP ${response.status} without a redirect location`);
      const location = response.location;
      current = new URL(location, current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
    return response.text;
  }
  throw new Error("too many redirects");
}

async function approve(policy: ToolPolicy, tool: string, input: unknown): Promise<boolean> {
  if (policy.mode !== "default" || !policy.requestApproval || !NEEDS_APPROVAL.has(tool)) return true;
  return policy.requestApproval({ tool, input });
}

/** Mode → what's allowed. Plan: read-only. Edit: files but no shell. Auto/default: all. */
function allowed(policy: ToolPolicy, toolName: string): boolean {
  if (policy.disabled.has(toolName)) return false;
  if (policy.mode === "plan") return ["read_file", "list_files", "web_fetch"].includes(toolName);
  if (policy.mode === "edit") return toolName !== "bash";
  return true;
}

async function smtpSend(to: string, subject: string, body: string): Promise<string> {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const host = process.env.EMAIL_SMTP_HOST ?? "smtp.gmail.com";
  if (!user || !pass) throw new Error("EMAIL_USER and EMAIL_APP_PASSWORD not set in .env");
  const transport = createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  await transport.sendMail({ from: user, to, subject, text: body });
  transport.close();
  return `Email sent to ${to} with subject "${subject}"`;
}

async function fetchEmails(opts: { todayOnly: boolean; maxCount: number }): Promise<string> {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const host = process.env.EMAIL_IMAP_HOST ?? "imap.gmail.com";
  if (!user || !pass) throw new Error("EMAIL_USER and EMAIL_APP_PASSWORD not set in .env");

  const client = new ImapFlow({
    host, port: 993, secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  const summaries: string[] = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = opts.todayOnly
        ? new Date(new Date().toDateString()) // midnight local time
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

      const uids: number[] = await client.search({ since }, { uid: true }) as number[];
      const recent = uids.slice(-opts.maxCount);

      for (const uid of recent) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true }) as { source?: Buffer } | null | undefined;
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.text ?? "unknown";
        const subject = parsed.subject ?? "(no subject)";
        const date = parsed.date?.toLocaleString() ?? "";
        const snippet = (parsed.text ?? "").slice(0, 300).replace(/\n+/g, " ").trim();
        summaries.push(`From: ${from}\nDate: ${date}\nSubject: ${subject}\nPreview: ${snippet}\n`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  if (summaries.length === 0) return "No emails found for the requested period.";
  return summaries.join("\n---\n");
}

async function executeTool<T>(
  policy: ToolPolicy,
  name: string,
  input: unknown,
  run: () => Promise<T>,
): Promise<T | string> {
  if (!allowed(policy, name)) {
    return `Tool "${name}" is not allowed in ${policy.mode} mode (or is toggled off).`;
  }
  if (!(await approve(policy, name, input))) return `Denied by user — ${name} not run.`;
  if (policy.mode !== "plan") {
    try {
      await runToolHooks(policy.cwd, "preToolUse", { tool: name, input });
    } catch (error) {
      return `Blocked by preToolUse hook for ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  try {
    const result = await run();
    try {
      if (policy.mode === "plan") return result;
      const hookOutput = await runToolHooks(policy.cwd, "postToolUse", { tool: name, input, result });
      return hookOutput.length && typeof result === "string"
        ? `${result}\n\n[postToolUse]\n${hookOutput.join("\n")}`
        : result;
    } catch (error) {
      return typeof result === "string"
        ? `${result}\n\n[postToolUse failed: ${error instanceof Error ? error.message : String(error)}]`
        : result;
    }
  } catch (error) {
    return `Error in ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function buildTools(policy: ToolPolicy): ToolSet {
  return {
    bash: tool({
      description:
        "Run a shell command in the project directory. Returns stdout+stderr (trimmed if huge).",
      inputSchema: z.object({ command: z.string().describe("The shell command to run") }),
      execute: ({ command }) =>
        executeTool(policy, "bash", { command }, async () => {
          const { stdout, stderr } = await execAsync(command, {
            cwd: policy.cwd,
            timeout: 60_000,
            windowsHide: true,
          });
          return diet([stdout, stderr].filter(Boolean).join("\n--- stderr ---\n") || "(no output)");
        }),
    }),

    read_file: tool({
      description: "Read a file (UTF-8) relative to the project directory.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) =>
        executeTool(policy, "read_file", { path }, async () =>
          diet(await readFile(await resolveWorkspacePath(policy.cwd, path), "utf8"))),
    }),

    write_file: tool({
      description: "Write/overwrite a file (UTF-8), creating parent directories.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: ({ path, content }) =>
        executeTool(policy, "write_file", { path, content }, async () => {
          const full = await resolveWorkspacePath(policy.cwd, path, { write: true });
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, content, "utf8");
          return `Wrote ${content.length} chars to ${path}`;
        }),
    }),

    list_files: tool({
      description: "List files in a directory (non-recursive) relative to the project.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: ({ path }) =>
        executeTool(policy, "list_files", { path }, async () => {
          const { readdir } = await import("node:fs/promises");
          const entries = await readdir(await resolveWorkspacePath(policy.cwd, path, { allowRoot: path === "." }), { withFileTypes: true });
          return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(empty)";
        }),
    }),

    web_fetch: tool({
      description: "Fetch a URL and return its text content (HTML tags stripped, trimmed).",
      inputSchema: z.object({ url: z.string().url() }),
      execute: ({ url }) =>
        executeTool(policy, "web_fetch", { url }, async () => {
          const text = await fetchPublicText(url);
          const stripped = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
          return diet(stripped);
        }),
    }),

    send_email: tool({
      description:
        "Send an email via SMTP. Uses the EMAIL_USER/EMAIL_APP_PASSWORD credentials from .env. " +
        "Use when the user asks to send, compose, or email someone.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Plain-text email body"),
      }),
      execute: ({ to, subject, body }) =>
        executeTool(policy, "send_email", { to, subject, body }, () =>
          smtpSend(to, subject, body)
        ),
    }),

    read_emails: tool({
      description:
        "Read emails from the Gmail inbox via IMAP. Use this to fetch, summarize, or list " +
        "recent or today's emails. Returns sender, date, subject and a short preview for each email.",
      inputSchema: z.object({
        today_only: z.boolean().default(true).describe("If true, fetch only today's emails; if false, fetch the last 7 days"),
        max_count: z.number().int().min(1).max(50).default(20).describe("Maximum number of emails to return"),
      }),
      execute: ({ today_only, max_count }) =>
        executeTool(policy, "read_emails", { today_only, max_count }, () =>
          fetchEmails({ todayOnly: today_only, maxCount: max_count })
        ),
    }),
  };
}

export type BuiltinToolName = keyof ReturnType<typeof buildTools>;
export const BUILTIN_TOOL_NAMES = ["bash", "read_file", "write_file", "list_files", "web_fetch", "send_email", "read_emails"] as const;
