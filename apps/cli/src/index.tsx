#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { render } from "ink";
import App from "./App.js";
import { ensureServer } from "./server.js";

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

/** The server's PID file — a stable per-user path (matches the server's own path),
 * so `--stop` works from any directory and whether run from the repo or installed. */
function pidFilePath(): string {
  return join(homedir(), ".personacode", "run", `server-${port}.json`);
}

function killPid(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" });
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Fallback: find and kill whatever process is LISTENING on `port` (any server,
 * even one started before PID files existed or by `pnpm dev`). Returns count killed. */
function killByPort(p: string): number {
  const pids = new Set<string>();
  if (process.platform === "win32") {
    const out = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split("\n")) {
      if (/LISTENING/i.test(line) && new RegExp(`[:.]${p}\\s`).test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== "0") pids.add(pid);
      }
    }
  } else {
    const out = spawnSync("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "";
    for (const pid of out.split("\n")) if (pid.trim()) pids.add(pid.trim());
  }
  for (const pid of pids) killPid(Number(pid));
  return pids.size;
}

// `pcode --stop`: stop the server however it was started — PID file first, then by port.
if (wantStop) {
  let stopped = false;
  const pf = pidFilePath();
  if (existsSync(pf)) {
    try {
      const { pid } = JSON.parse(readFileSync(pf, "utf8")) as { pid: number };
      killPid(pid);
      stopped = true;
      console.log(`Stopped Personacode server (pid ${pid}).`);
    } catch {
      /* fall through to port scan */
    }
    rmSync(pf, { force: true });
  }
  if (!stopped && killByPort(port) > 0) {
    stopped = true;
    console.log(`Stopped Personacode server on port ${port}.`);
  }
  if (!stopped) console.log(`No running Personacode server found for port ${port}.`);
  process.exit(0);
}

/** Open a URL in the user's default browser (best-effort, cross-platform). */
function openBrowser(url: string): void {
  if (process.env.PERSONACODE_NO_BROWSER === "1") return;
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
    return;
  }
  const [cmd, cmdArgs]: [string, string[]] =
    process.platform === "darwin"
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
  console.log("  Server is running in the background — run `pcode --stop` to stop it.");
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(0);
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
