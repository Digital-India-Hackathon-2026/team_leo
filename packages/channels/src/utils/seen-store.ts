import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persists a set of seen message identifiers to a JSON file.
 * Used by the email adapter to skip already-processed messages after restarts.
 */
export class SeenStore {
  private seen: Set<string>;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.seen = new Set();
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, "utf8"));
        if (Array.isArray(data)) {
          for (const id of data) this.seen.add(String(id));
        }
      }
    } catch {
      // Corrupted file — start fresh
      this.seen = new Set();
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.seen], null, 2), "utf8");
    } catch (err) {
      console.error("[seen-store] failed to persist:", (err as Error).message);
    }
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (!this.seen.has(id)) {
      this.seen.add(id);
      this.persist();
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
