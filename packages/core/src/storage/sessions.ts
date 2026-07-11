import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LanguageCode, Mode, Session, SessionMeta, TokenUsage } from "@personacode/contracts";

/**
 * File-per-session JSON store under .personacode/data/sessions/.
 * Deliberately zero native deps (beginner-friendly on Windows) and
 * human-readable — you can open any session file in an editor.
 */
export class SessionStore {
  private dir: string;

  constructor(root = process.cwd()) {
    this.dir = join(root, ".personacode", "data", "sessions");
    mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string): string {
    // ids are UUIDs we generate; guard anyway
    if (!/^[\w-]+$/.test(id)) throw new Error("bad session id");
    return join(this.dir, `${id}.json`);
  }

  create(init: { title?: string; model: string; mode?: Mode; language?: LanguageCode; terse?: boolean }): Session {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      title: init.title ?? "New session",
      createdAt: now,
      updatedAt: now,
      model: init.model,
      mode: init.mode ?? "default",
      language: init.language,
      terse: init.terse,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      messages: [],
    };
    this.save(session);
    return session;
  }

  get(id: string): Session | undefined {
    const f = this.file(id);
    if (!existsSync(f)) return undefined;
    return JSON.parse(readFileSync(f, "utf8")) as Session;
  }

  list(): SessionMeta[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const { messages: _m, ...meta } = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Session;
        return meta;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  save(session: Session): void {
    session.updatedAt = Date.now();
    writeFileSync(this.file(session.id), JSON.stringify(session, null, 2), "utf8");
  }

  addUsage(id: string, usage: TokenUsage): void {
    const s = this.get(id);
    if (!s) return;
    s.usage.inputTokens += usage.inputTokens;
    s.usage.outputTokens += usage.outputTokens;
    s.usage.totalTokens += usage.totalTokens;
    this.save(s);
  }

  delete(id: string): void {
    rmSync(this.file(id), { force: true });
  }
}
