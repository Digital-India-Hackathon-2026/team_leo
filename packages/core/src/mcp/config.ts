import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * MCP server config, read from `.personacode/mcp.json` (Claude-Code-style shape):
 *   {
 *     "mcpServers": {
 *       "everything": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"] },
 *       "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
 *     }
 *   }
 * A `url` means streamable-HTTP transport; otherwise stdio (spawns `command`).
 */
export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
export interface HttpServerConfig {
  type?: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}
export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export function isHttpConfig(c: McpServerConfig): c is HttpServerConfig {
  return typeof (c as HttpServerConfig).url === "string";
}

export function mcpConfigPath(cwd: string): string {
  return join(cwd, ".personacode", "mcp.json");
}

export async function loadMcpConfig(cwd: string): Promise<Record<string, McpServerConfig>> {
  try {
    const raw = await readFile(mcpConfigPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/** Namespaced tool name so MCP tools never collide with builtins or each other. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}
