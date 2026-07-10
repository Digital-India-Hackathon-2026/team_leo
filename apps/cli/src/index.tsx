#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { render } from "ink";
import App from "./App.js";
import { ensureServer, findRepoRoot } from "./server.js";

// Load .env from the nearest ancestor that has one, so keys are found no matter
// which directory `personacode`/`pnpm cli` is launched from (dotenv's default
// only checks cwd, which is apps/cli under pnpm — missing the repo-root .env).
(function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig({ quiet: true });
})();

const args = process.argv.slice(2);
const port = process.env.PERSONACODE_PORT ?? "3789";

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Personacode CLI\n\n" +
      "  pcode            Start the terminal chat (TUI)\n" +
      "  pcode --web      Open the local web app in your browser + host it on your network\n" +
      "  pcode --stop     Stop the running Personacode server\n" +
      "  pcode --help     Show this help\n"
  );
  process.exit(0);
}

const wantStop = args.includes("--stop") || args[0] === "stop";
const wantWeb = args.includes("--web") || args.includes("-w") || args[0] === "web";

/** IPv4 LAN URLs other devices on the same Wi-Fi can open. */
function lanUrls(): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const ni of addrs ?? []) {
      if (ni.family === "IPv4" && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

/** Locate the server's PID file (written by the server on boot). */
function pidFilePath(): string | null {
  const root =
    findRepoRoot(process.cwd()) ??
    findRepoRoot(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
  return root ? join(root, ".personacode", `server-${port}.pid`) : null;
}

// `pcode --stop`: read the PID file and stop the server (however it was started).
if (wantStop) {
  const pf = pidFilePath();
  if (!pf || !existsSync(pf)) {
    console.log(`No running Personacode server found for port ${port}.`);
    process.exit(0);
  }
  try {
    const { pid } = JSON.parse(readFileSync(pf, "utf8")) as { pid: number };
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
    rmSync(pf, { force: true });
    console.log(`Stopped Personacode server (pid ${pid}).`);
    process.exit(0);
  } catch (err) {
    console.error(`Could not stop the server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** Open a URL in the user's default browser (best-effort, cross-platform). */
function openBrowser(url: string): void {
  const [cmd, cmdArgs]: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort — the URL is printed regardless so the user can open it manually */
  }
}

// Route chat through the server so the CLI inherits PERSONA.md/memory, MCP tools,
// checkpoints, and auto-compaction. Reuse a running server or spawn one; fail-soft.
// `--web` binds the spawned server to 0.0.0.0 so teammates on the LAN can reach it.
const srv = await ensureServer(wantWeb ? { host: "0.0.0.0" } : {});
if (srv.error) {
  console.error(
    `⚠ ${srv.error}\n  Start it in another terminal with \`pnpm dev\` (or \`pnpm dev:mock\`), then run \`pcode\` again.`
  );
  process.exit(1);
}

// `pcode --web`: open the built web app (served by the same server) instead of the TUI.
if (wantWeb) {
  const res = await fetch(srv.base, { signal: AbortSignal.timeout(2500) }).catch(() => null);
  if (!res || res.status === 404) {
    console.error(
      "⚠ The web app isn't built yet. Run `pnpm build` (or `pnpm --filter @personacode/web build`), then `pcode --web`."
    );
    if (srv.started) srv.child?.kill();
    process.exit(1);
  }
  openBrowser(srv.base);
  const lans = lanUrls();
  console.log(`◆ Personacode web app${srv.mock ? "  (mock mode — no API keys needed)" : ""}`);
  console.log(`  Local:   ${srv.base}`);
  for (const u of lans) console.log(`  Network: ${u}   ← teammates on the same Wi-Fi open this`);

  if (!srv.started) {
    // Reusing a server we didn't start — it may be bound to localhost only.
    const pf = pidFilePath();
    let hostOnly = false;
    try {
      if (pf && existsSync(pf)) hostOnly = (JSON.parse(readFileSync(pf, "utf8")).hostname ?? "") !== "0.0.0.0";
    } catch {
      /* ignore */
    }
    if (hostOnly && lans.length) {
      console.log("  ⚠ A server is already running but is localhost-only. To share it on your");
      console.log("     network, run `pcode --stop` then `pcode --web`.");
    }
    console.log("  (using the server already running — it keeps running after this exits; `pcode --stop` to stop it)");
    process.exit(0);
  }

  if (lans.length) console.log(`  If a teammate can't connect, allow port ${port} through your firewall.`);
  console.log("  Server started by this command — press Ctrl+C to stop it (or run `pcode --stop`).");
  const stop = () => {
    srv.child?.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise<never>(() => {}); // keep the spawned server running until Ctrl+C
}

// Run in the terminal's alternate screen buffer (like opencode / vim / less):
// the CLI gets a clean fullscreen surface, and on exit the user's previous
// scrollback is restored intact — not wiped, just tucked back.
const ALT_ENTER = "\x1b[?1049h";
const ALT_LEAVE = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";
let restored = false;
function restoreScreen() {
  if (restored) return;
  restored = true;
  process.stdout.write(ALT_LEAVE + SHOW_CURSOR);
}

process.stdout.write(ALT_ENTER);
const { waitUntilExit } = render(<App base={srv.base} mock={srv.mock} />);

function shutdown() {
  restoreScreen();
  if (srv.started) srv.child?.kill(); // only kill a server we spawned
}

// Safety nets so the main screen is always restored, however we leave.
process.on("exit", shutdown);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

waitUntilExit().then(() => {
  shutdown();
  // Back on the user's normal shell prompt now — leave a short hint like Claude Code.
  console.log("Personacode session ended — run `pcode` to start again.");
  process.exit(0);
});
