import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { UIMessage } from "ai";
import type { Mode } from "@personacode/contracts";
import { MODE_LABELS } from "@personacode/contracts";
import { contextWindowFor, defaultModelRef } from "@personacode/core";
import {
  createSession,
  streamChat,
  getMcp,
  getCheckpoints,
  restoreCheckpoint,
  getMemory,
  getSkills,
  getUsage,
  respondPermission,
  type CheckpointRow,
  type PermissionRequest,
} from "./api.js";

const MODES: Mode[] = ["default", "auto", "plan", "edit"];

/** 648 → "648", 12_345 → "12.3k", 1_048_576 → "1M". */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

interface Line {
  role: "user" | "assistant" | "system";
  text: string;
}

const INIT_PROMPT =
  "Scan this project (languages, frameworks, scripts, conventions) and write a concise PERSONA.md " +
  "at the repo root capturing how to build/run/test it and any rules an agent should follow. " +
  "Use the read_file/list_files/bash tools to investigate, then write_file the result.";

export default function App({ base, mock }: { base: string; mock: boolean }) {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("default");
  const [busy, setBusy] = useState(false);
  const [crew, setCrew] = useState(false);
  const [pav, setPav] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRow[]>([]);
  const [pendingPerm, setPendingPerm] = useState<PermissionRequest | null>(null);
  const [model, setModel] = useState<string>(() => {
    try {
      return defaultModelRef();
    } catch {
      return mock ? "mock/mock" : "(no provider — /connect or set PERSONACODE_MOCK=1)";
    }
  });

  // Create a server-backed session on mount (enables context/checkpoints/usage).
  useEffect(() => {
    createSession(base, { mode, model: model.startsWith("(") ? undefined : model })
      .then(setSessionId)
      .catch(() => sys("could not create a session — is the server up? (pnpm dev)"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sys = (text: string) => setLines((l) => [...l, { role: "system", text }]);

  async function answerPerm(decision: "allow" | "deny" | "always") {
    if (!pendingPerm) return;
    await respondPermission(base, pendingPerm.id, decision);
    sys(`🔒 ${decision === "deny" ? "denied" : decision === "always" ? "always allowed" : "allowed"} ${pendingPerm.tool}`);
    setPendingPerm(null);
  }

  useInput((input, key) => {
    // While a permission prompt is up, y/a/n (or Enter=allow, Esc=deny) answer it.
    if (pendingPerm) {
      if (input === "y" || key.return) void answerPerm("allow");
      else if (input === "a") void answerPerm("always");
      else if (input === "n" || key.escape) void answerPerm("deny");
      return;
    }
    if (key.escape && busy) {
      abortRef.current?.abort();
      sys("⎋ interrupted");
    }
    if (key.tab && key.shift) setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  });

  async function handleCommand(cmd: string): Promise<void> {
    const [name, ...args] = cmd.slice(1).split(" ");
    switch (name) {
      case "exit":
      case "quit":
        return exit();
      case "mode":
        if (args[0] && MODES.includes(args[0] as Mode)) setMode(args[0] as Mode);
        else sys(`modes: ${MODES.join(", ")} (current: ${mode})`);
        return;
      case "model":
        if (args[0]) setModel(args[0]);
        else sys(`model: ${model}`);
        return;
      case "connect":
        sys("Add a free key to .env (GOOGLE_/GROQ_/CEREBRAS_…) then restart, or set PERSONACODE_MOCK=1. Web /connect UI is richer.");
        return;
      case "init":
        sys("scanning project → writing PERSONA.md…");
        return void submit(INIT_PROMPT, true);
      case "mcp": {
        sys("MCP servers:");
        try {
          const { servers } = await getMcp(base);
          if (servers.length === 0) sys("  (none configured — add .personacode/mcp.json)");
          for (const s of servers)
            sys(`  ${s.connected ? "●" : "○"} ${s.name}${s.error ? ` — ${s.error}` : ` (${s.tools.length} tools)`}`);
        } catch {
          sys("  (server unreachable)");
        }
        return;
      }
      case "memory": {
        try {
          const mems = await getMemory(base);
          sys(mems.length ? "memory:" : "memory: (empty — .personacode/memory/)");
          for (const m of mems) sys(`  • ${m.name} — ${m.description}`);
        } catch {
          sys("memory: (server unreachable)");
        }
        return;
      }
      case "skills": {
        try {
          const sk = await getSkills(base);
          sys(sk.length ? "skills:" : "skills: (none — .personacode/skills/)");
          for (const s of sk) sys(`  • ${s.name} — ${s.description}`);
        } catch {
          sys("skills: (server unreachable)");
        }
        return;
      }
      case "rewind": {
        try {
          const cps = await getCheckpoints(base);
          setCheckpoints(cps);
          if (args[0]) {
            const idx = Number(args[0]) - 1;
            const target = cps[idx];
            if (!target) return sys(`no checkpoint #${args[0]} (see /rewind)`);
            const ok = await restoreCheckpoint(base, target.hash);
            return sys(ok ? `↺ restored checkpoint #${args[0]}: ${target.label}` : "restore failed");
          }
          sys(cps.length ? "checkpoints (use /rewind <n>):" : "checkpoints: (none yet)");
          cps.slice(0, 10).forEach((c, i) => sys(`  ${i + 1}. ${c.label}`));
        } catch {
          sys("checkpoints: (server unreachable)");
        }
        return;
      }
      case "usage": {
        if (!sessionId) return sys("usage: (no session)");
        const u = await getUsage(base, sessionId);
        return sys(u ? `usage: ${fmtNum(u.total.totalTokens)} tokens · ${(u.contextPercent * 100).toFixed(1)}% of context` : "usage: (unavailable)");
      }
      case "compact":
        sys(`compaction is automatic near the context limit (currently ${ctxPct.toFixed(0)}% of ${fmtNum(ctxWindow)}).`);
        return;
      case "crew": {
        const on = args[0] ? args[0] === "on" : !crew;
        setCrew(on);
        sys(`⚡ Model Crew ${on ? "ON" : "off"} — ${on ? "a fast scout gathers file context before the brain answers" : "single-model turns"}`);
        return;
      }
      case "pav": {
        const on = args[0] ? args[0] === "on" : !pav;
        setPav(on);
        sys(`⚙ PAV Loop ${on ? "ON" : "off"} — ${on ? "next message runs Plan → Apply → Verify (edits files, then runs your typecheck/test scripts, looping on failure)" : "normal single turn"}`);
        return;
      }
      case "help":
        sys("/init /memory /skills /mcp /rewind [n] /usage /compact /crew [on|off] /pav [on|off] /mode <m> /model <ref> /connect /exit · Shift+Tab cycles modes · Esc interrupts");
        return;
      default:
        sys(`Unknown command: /${name}`);
    }
  }

  async function submit(value: string, fromCommand = false) {
    const text = value.trim();
    if (!text || busy) return;
    if (!fromCommand) setInput("");
    if (text.startsWith("/") && !fromCommand) return void handleCommand(text);

    const userMsg: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    const messages = [...history, userMsg];
    setHistory(messages);
    setLines((l) => [...l, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        base,
        {
          sessionId,
          messages,
          model: model.startsWith("(") ? undefined : model,
          mode,
          orchestrate: crew,
          pav,
          approvals: true,
        },
        {
          onTextDelta: (delta) =>
            setLines((l) => {
              const copy = [...l];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "assistant") {
                  copy[i] = { ...copy[i], text: copy[i].text + delta };
                  break;
                }
              }
              return copy;
            }),
          onFallback: (from, to) => sys(`⇄ fallback: ${from} → ${to}`),
          onOrchestration: (s) => sys(`⚡ ${s.stage} ${s.model} — ${s.detail} · ${(s.ms / 1000).toFixed(1)}s`),
          onPav: (s) =>
            sys(
              `⚙ PAV ${s.phase}${s.iteration ? ` #${s.iteration}` : ""} — ${s.detail}` +
                (s.model ? ` · ${s.model}` : "") +
                (s.planPath ? ` (${s.planPath})` : "") +
                (s.ms ? ` · ${(s.ms / 1000).toFixed(1)}s` : "")
            ),
          onPermission: (req) => setPendingPerm(req),
          onCompaction: () => sys("⟳ history auto-compacted to fit the context window"),
          onError: (m) => sys(`✖ ${m}`),
        },
        controller.signal
      );
      // Persist the assistant reply into local history for the next turn.
      setLines((l) => {
        const last = [...l].reverse().find((x) => x.role === "assistant");
        if (last?.text)
          setHistory((h) => [...h, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: last.text }] }]);
        return l;
      });
      if (sessionId) getUsage(base, sessionId).then((u) => u && setTokens(u.total.totalTokens));
    } catch (err) {
      if (!controller.signal.aborted) sys(`✖ ${String((err as Error).message)}`);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const modeInfo = MODE_LABELS[mode];
  const ctxWindow = model.startsWith("(") ? 0 : contextWindowFor(model);
  const ctxPct = ctxWindow > 0 ? (tokens / ctxWindow) * 100 : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="magentaBright">◆ Personacode</Text>
        {mock && <Text color="yellow">  [MOCK]</Text>}
        {!sessionId && <Text dimColor>  connecting…</Text>}
      </Box>

      {lines.slice(-30).map((line, i) => (
        <Box key={i} marginBottom={line.role === "assistant" ? 1 : 0}>
          <Text
            color={line.role === "user" ? "cyan" : line.role === "system" ? "yellow" : undefined}
            dimColor={line.role === "system"}
          >
            {line.role === "user" ? "❯ " : line.role === "system" ? "· " : ""}
            {line.text || (busy && line.role === "assistant" ? "…" : "")}
          </Text>
        </Box>
      ))}

      {pendingPerm ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">
            🔒 Allow <Text bold>{pendingPerm.tool}</Text>
            {(() => {
              const inp = pendingPerm.input as { command?: string; path?: string };
              const d = inp?.command ?? inp?.path;
              return d ? <Text dimColor> {d}</Text> : null;
            })()}
            ?
          </Text>
          <Text dimColor>[y]es · [a]lways · [n]o (Enter=yes, Esc=no)</Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={mode === "auto" ? "yellow" : "gray"} paddingX={1}>
          <Text color="magentaBright">❯ </Text>
          <TextInput value={input} onChange={setInput} onSubmit={(v) => submit(v)} placeholder="Message… (/help)" />
        </Box>
      )}

      <Box gap={2}>
        <Text dimColor>{model}</Text>
        <Text color={mode === "auto" ? "yellow" : mode === "plan" ? "blue" : "gray"}>{modeInfo.chip}</Text>
        {crew && <Text color="magentaBright">⚡ Crew</Text>}
        {pav && <Text color="greenBright">⚙ PAV</Text>}
        <Text dimColor>
          {fmtNum(tokens)}
          {ctxWindow > 0 ? `/${fmtNum(ctxWindow)} · ${ctxPct.toFixed(ctxPct < 10 ? 1 : 0)}%` : " tok"}
        </Text>
        <Text dimColor>Shift+Tab: mode</Text>
      </Box>
    </Box>
  );
}
