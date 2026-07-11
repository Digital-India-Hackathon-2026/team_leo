import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DeliveryConfig } from "../delivery/index.js";

/**
 * Per-agent delivery credentials store. Lives in the git-ignored `.personacode/secrets.json`
 * (the whole `.personacode/` dir is git-ignored). Server-side only: these values are never
 * returned by any API and never logged — the server reads them to send, that's it. Keyed by
 * lower-cased agent name so each agent carries its own bot token / webhook / mailbox.
 */
export class DeliveryStore {
  private readonly path: string;
  private cache: Record<string, DeliveryConfig> | null = null;

  constructor(root = process.cwd()) {
    const dir = join(root, ".personacode");
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "secrets.json");
  }

  private read(): Record<string, DeliveryConfig> {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) return (this.cache = {});
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      this.cache = value && typeof value === "object" ? (value as Record<string, DeliveryConfig>) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private write(data: Record<string, DeliveryConfig>): void {
    this.cache = data;
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
    renameSync(temporary, this.path);
  }

  private static key(agentName: string): string {
    return agentName.trim().toLowerCase();
  }

  get(agentName: string): DeliveryConfig | undefined {
    return this.read()[DeliveryStore.key(agentName)];
  }

  set(agentName: string, config: DeliveryConfig): void {
    const data = { ...this.read() };
    data[DeliveryStore.key(agentName)] = config;
    this.write(data);
  }

  delete(agentName: string): void {
    const data = { ...this.read() };
    if (delete data[DeliveryStore.key(agentName)]) this.write(data);
  }
}
