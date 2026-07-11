import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** A single language-server diagnostic, normalized to 1-based line/col. */
export interface LspDiagnostic {
  file: string; // workspace-relative path
  line: number; // 1-based
  col: number; // 1-based
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

/** LSP DiagnosticSeverity (1=Error … 4=Hint) → our label. */
const SEVERITY: Record<number, LspDiagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

/** Canonical fs-path key: resolved + forward slashes + case-folded on win32. */
function normalizePath(p: string): string {
  const resolved = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * A minimal Language Server Protocol client over stdio. Speaks just enough JSON-RPC to
 * open files and collect `textDocument/publishDiagnostics` — no completion/hover/etc.
 * Every server that follows the base protocol works; we never assume server-specifics.
 *
 * Lifecycle: `new LspClient(...)` → `await initialize(rootDir)` → `openAndCollect(files)`
 * → `await dispose()`. Fail-soft: a dead/slow server yields empty diagnostics, never a
 * throw that escapes `getDiagnostics`.
 */
export class LspClient {
  private readonly proc: ChildProcess;
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** file URI → latest diagnostics array from the server. */
  private readonly diagnostics = new Map<string, unknown[]>();
  /** Resolves whenever a publishDiagnostics notification lands (settle detection). */
  private onPublish: (() => void) | null = null;
  private closed = false;

  constructor(command: string, args: string[], cwd: string) {
    this.proc = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stdout?.on("error", () => {});
    this.proc.stderr?.on("data", () => {}); // language servers are chatty on stderr; ignore
    this.proc.on("error", () => this.fail(new Error("language server failed to start")));
    this.proc.on("exit", () => {
      this.closed = true;
      this.fail(new Error("language server exited"));
    });
  }

  private fail(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Parse as many complete `Content-Length: N\r\n\r\n<json>` frames as are buffered.
    for (;;) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        this.contentLength = match ? Number(match[1]) : 0;
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }
      if (this.buffer.length < this.contentLength) return;
      const body = this.buffer.subarray(0, this.contentLength).toString("utf8");
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = -1;
      try {
        this.handle(JSON.parse(body));
      } catch {
        /* ignore malformed frame */
      }
    }
  }

  private handle(msg: {
    id?: number;
    method?: string;
    result?: unknown;
    error?: { message?: string };
    params?: { uri?: string; diagnostics?: unknown[]; items?: unknown[] };
  }): void {
    // Response to one of our requests.
    if (typeof msg.id === "number" && !msg.method && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "LSP error"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics" && msg.params?.uri) {
      this.diagnostics.set(msg.params.uri, msg.params.diagnostics ?? []);
      this.onPublish?.();
    }
    // Server→client requests that expect a reply. workspace/configuration wants one
    // settings object per requested item (empty object = "use your defaults"), else the
    // server may stall before analyzing. Everything else is acked with null.
    if (typeof msg.id === "number" && msg.method) {
      const result =
        msg.method === "workspace/configuration"
          ? (msg.params?.items ?? []).map(() => ({}))
          : null;
      this.send({ jsonrpc: "2.0", id: msg.id, result });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed || !this.proc.stdin?.writable) return;
    const json = JSON.stringify(message);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async initialize(rootDir: string): Promise<void> {
    const rootUri = pathToFileURL(rootDir).href;
    await this.request(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "workspace" }],
        capabilities: {
          textDocument: { publishDiagnostics: { relatedInformation: false } },
          workspace: { configuration: true, workspaceFolders: true },
        },
      },
      12_000,
    );
    this.notify("initialized", {});
  }

  /**
   * Open each file, then wait for the diagnostics stream to settle (no new
   * publishDiagnostics for `quietMs`, capped at `maxMs`). Returns the accumulated
   * diagnostics for the opened URIs. Servers usually publish once on open and again
   * after analysis, so settle-detection beats a fixed sleep.
   */
  async openAndCollect(
    files: Array<{ absPath: string; relPath: string; languageId: string; text: string }>,
    quietMs = 1_600,
    maxMs = 12_000,
  ): Promise<LspDiagnostic[]> {
    // Key by normalized fs path, not the raw URI: servers echo back a re-encoded URI
    // (drive-letter case, %3A, trailing slashes) that won't string-match ours.
    const byPath = new Map<string, string>(); // normalized abs path → relPath
    for (const f of files) {
      byPath.set(normalizePath(f.absPath), f.relPath);
      this.notify("textDocument/didOpen", {
        textDocument: { uri: pathToFileURL(f.absPath).href, languageId: f.languageId, version: 1, text: f.text },
      });
    }

    await new Promise<void>((resolvePromise) => {
      const hardStop = setTimeout(finish, maxMs);
      let quietTimer = setTimeout(finish, quietMs);
      this.onPublish = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      };
      function finish() {
        clearTimeout(hardStop);
        clearTimeout(quietTimer);
        resolvePromise();
      }
    });
    this.onPublish = null;

    const out: LspDiagnostic[] = [];
    for (const [uri, diags] of this.diagnostics) {
      let rel: string | undefined;
      try {
        rel = byPath.get(normalizePath(fileURLToPath(uri)));
      } catch {
        rel = undefined;
      }
      if (!rel) continue;
      for (const raw of diags) {
        const d = raw as {
          range?: { start?: { line?: number; character?: number } };
          severity?: number;
          message?: string;
          source?: string;
          code?: string | number;
        };
        out.push({
          file: rel,
          line: (d.range?.start?.line ?? 0) + 1,
          col: (d.range?.start?.character ?? 0) + 1,
          severity: SEVERITY[d.severity ?? 1] ?? "error",
          message: (d.message ?? "").replace(/\s+/g, " ").trim(),
          source: d.source,
          code: d.code,
        });
      }
    }
    return out;
  }

  async dispose(): Promise<void> {
    try {
      if (!this.closed) {
        await this.request("shutdown", null, 1_500).catch(() => {});
        this.notify("exit", null);
      }
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}
