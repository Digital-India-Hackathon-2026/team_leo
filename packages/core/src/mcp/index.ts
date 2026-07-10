export * from "./config.js";
export { McpManager, type McpToolInfo } from "./manager.js";

import { McpManager } from "./manager.js";

/** Process-wide singleton so stdio child processes are shared across turns. */
let singleton: McpManager | undefined;
export function getMcpManager(): McpManager {
  return (singleton ??= new McpManager());
}
