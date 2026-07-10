import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Mode } from "@personacode/contracts";
import { loadMcpConfig, isHttpConfig, mcpToolName, type McpServerConfig } from "./config.js";

const MAX_MCP_OUTPUT = 8_000;
function diet(s: string): string {
  return s.length <= MAX_MCP_OUTPUT ? s : s.slice(0, MAX_MCP_OUTPUT) + `\n… [${s.length - MAX_MCP_OUTPUT} chars trimmed]`;
}

export interface McpToolInfo {
  server: string;
  tool: string;
  qualifiedName: string; // mcp__server__tool
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  tools: McpToolInfo[];
  error?: string;
}

/**
 * Connects to the MCP servers configured in `.personacode/mcp.json` and exposes
 * their tools as an AI-SDK ToolSet. Connect is lazy + memoized per cwd so we don't
 * respawn stdio child processes on every turn; any server that fails to connect is
 * skipped (never crashes a turn). Tools are namespaced `mcp__server__tool`.
 */
export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private connectPromise?: Promise<void>;
  private connectedCwd?: string;

  /** Connect all configured servers once (memoized per cwd). Safe to call every turn. */
  async ensureConnected(cwd: string): Promise<void> {
    if (this.connectedCwd === cwd && this.connectPromise) return this.connectPromise;
    this.connectedCwd = cwd;
    this.connectPromise = this.connectAll(cwd);
    return this.connectPromise;
  }

  private async connectAll(cwd: string): Promise<void> {
    const config = await loadMcpConfig(cwd);
    await Promise.all(Object.entries(config).map(([name, cfg]) => this.connectOne(name, cfg, cwd)));
  }

  private async connectOne(name: string, cfg: McpServerConfig, cwd: string): Promise<void> {
    const client = new Client({ name: "personacode", version: "0.1.0" });
    try {
      const transport = isHttpConfig(cfg)
        ? new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
          })
        : new StdioClientTransport({
            command: cfg.command,
            args: cfg.args,
            env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) },
            cwd: cfg.cwd ?? cwd,
          });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.servers.set(name, {
        name,
        client,
        tools: tools.map((t) => ({
          server: name,
          tool: t.name,
          qualifiedName: mcpToolName(name, t.name),
          description: t.description ?? "",
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        })),
      });
    } catch (err) {
      this.servers.set(name, {
        name,
        client,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** All configured servers with connect status + tool names (powers /mcp and /api/mcp). */
  status(): { name: string; connected: boolean; error?: string; tools: string[] }[] {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      connected: !s.error,
      error: s.error,
      tools: s.tools.map((t) => t.tool),
    }));
  }

  listTools(): McpToolInfo[] {
    return [...this.servers.values()].flatMap((s) => s.tools);
  }

  /**
   * Build an AI-SDK ToolSet from connected MCP tools. `disabled` holds qualified
   * names toggled off. Plan mode (read-only) disables all MCP tools since we can't
   * know their side effects.
   */
  buildToolSet(opts: { mode: Mode; disabled: Set<string> }): ToolSet {
    const set: ToolSet = {};
    if (opts.mode === "plan") return set;
    for (const server of this.servers.values()) {
      if (server.error) continue;
      for (const info of server.tools) {
        if (opts.disabled.has(info.qualifiedName)) continue;
        const client = server.client;
        const toolName = info.tool;
        set[info.qualifiedName] = tool({
          description: `[MCP:${server.name}] ${info.description}`,
          inputSchema: jsonSchema(info.inputSchema),
          execute: async (args) => {
            try {
              const res = await client.callTool({ name: toolName, arguments: args as Record<string, unknown> });
              return diet(renderToolResult(res));
            } catch (err) {
              return `MCP tool ${info.qualifiedName} failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        });
      }
    }
    return set;
  }

  async close(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => s.client.close().catch(() => {})));
    this.servers.clear();
    this.connectPromise = undefined;
    this.connectedCwd = undefined;
  }
}

function renderToolResult(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content;
  if (!Array.isArray(content)) return JSON.stringify(res);
  return content
    .map((part) => (part.type === "text" ? part.text ?? "" : `[${part.type}]`))
    .join("\n")
    .trim();
}
