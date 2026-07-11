import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { UIMessage } from "ai";
import type { LanguageCode, ModelInfo, Mode } from "@personacode/contracts";
import { LANGUAGE_LABELS, MODE_LABELS } from "@personacode/contracts";
import { contextWindowFor, defaultModelRef } from "@personacode/core";
import {
  createSession,
  streamChat,
  getMcp,
  getCheckpoints,
  restoreCheckpoint,
  getMemory,
  getSkills,
  getHooks,
  createAgent,
  getAgents,
  deleteAgent,
  getModels,
  runSetupScout,
  getUsage,
  respondPermission,
  type CheckpointRow,
  type PermissionRequest,
} from "./api.js";

const MODES: Mode[] = ["default", "auto", "plan", "edit"];

interface Cmd {
  name: string;
  args?: string;
  desc: string;
}
/** Slash commands for the autocomplete menu (shown as you type `/`). */
const COMMANDS: Cmd[] = [
  { name: "init", desc: "scan project → write PERSONA.md" },
  { name: "setup", args: "[apply]", desc: "Setup Scout: recommend MCP / skills / PERSONA.md" },
  { name: "agent", args: 'new "…" | use "…" | delete "…" | off', desc: "build, select, or delete a custom agent" },
  { name: "research", args: "[on|off]", desc: "Deep Research starter agent" },
  { name: "lang", args: "<code|off>", desc: "Bharat Mode response language" },
  { name: "terse", args: "[on|off]", desc: "minimal-token responses" },
  { name: "memory", desc: "list recalled memory" },
  { name: "skills", desc: "list skills" },
  { name: "mcp", desc: "list MCP servers" },
  { name: "hooks", desc: "list hooks.json hooks" },
  { name: "rewind", args: "[n]", desc: "list / restore checkpoints" },
  { name: "usage", desc: "token usage this session" },
  { name: "compact", desc: "compaction status" },
  { name: "crew", args: "[on|off]", desc: "⚡ Model Crew orchestration" },
  { name: "pav", args: "[on|off]", desc: "⚙ Plan → Apply → Verify loop" },
  { name: "mode", args: "<m>", desc: "default | auto | plan | edit" },
  { name: "model", args: "<ref>", desc: "set the model" },
  { name: "connect", desc: "how to add a provider key" },
  { name: "help", desc: "list all commands" },
  { name: "exit", desc: "quit Personacode" },
];

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
  const [inputKey, setInputKey] = useState(0); // bump to remount TextInput → cursor jumps to end
  const [selected, setSelected] = useState(0); // highlighted autocomplete suggestion
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mode, setMode] = useState<Mode>("default");
  const [busy, setBusy] = useState(false);
  const [crew, setCrew] = useState(false);
  const [pav, setPav] = useState(false);
  const [agentName, setAgentName] = useState<string | undefined>();
  const [language, setLanguage] = useState<LanguageCode | undefined>();
  const [terse, setTerse] = useState(false);
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

  // Slash-command autocomplete: show a filtered menu while typing `/name` (no space yet).
  const slashQuery = !busy && input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  const commandSuggestions = slashQuery !== null ? COMMANDS.filter((c) => c.name.startsWith(slashQuery)) : [];

  // Model autocomplete: after `/model ` show matching models, grouped by provider.
  const modelMatch = !busy ? input.match(/^\/model\s+(.*)$/s) : null;
  const modelQuery = modelMatch ? modelMatch[1]!.toLowerCase().trim() : null;
  const modelSuggestions =
    modelQuery !== null ? models.filter((m) => m.ref.toLowerCase().includes(modelQuery)) : [];

  // Exactly one menu is active at a time (input shape is mutually exclusive).
  const menuKind: "command" | "model" | null = commandSuggestions.length
    ? "command"
    : modelSuggestions.length
      ? "model"
      : null;
  const menuLen = menuKind === "command" ? commandSuggestions.length : modelSuggestions.length;
  const sel = menuLen ? Math.min(selected, menuLen - 1) : 0;
  const MENU_WINDOW = 8;
  // Scrolling window that always keeps the highlighted row visible.
  const winStart = Math.max(0, Math.min(sel - MENU_WINDOW + 1, menuLen - MENU_WINDOW));

  // Create a server-backed session on mount (enables context/checkpoints/usage).
  useEffect(() => {
    createSession(base, { mode, model: model.startsWith("(") ? undefined : model, language, terse })
      .then(setSessionId)
      .catch(() => sys("could not create a session — is the server up? (pnpm dev)"));
    getModels(base).then(setModels).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Set input text and jump the cursor to the end (remount forces cursorOffset=length). */
  function setInputEnd(v: string) {
    setInput(v);
    setInputKey((k) => k + 1);
    setSelected(0);
  }

  const sys = (text: string) => setLines((l) => [...l, { role: "system", text }]);

  async function answerPerm(decision: "allow" | "deny" | "always") {
    if (!pendingPerm) return;
    try {
      await respondPermission(base, pendingPerm.id, decision);
      sys(`🔒 ${decision === "deny" ? "denied" : decision === "always" ? "always allowed" : "allowed"} ${pendingPerm.tool}`);
      setPendingPerm(null);
    } catch {
      sys("permission response failed — retry y/a/n");
    }
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
    // Autocomplete menu navigation (ink-text-input ignores Tab / ↑ / ↓, so these are free).
    if (menuLen > 0) {
      if (key.downArrow) return void setSelected((s) => (Math.min(s, menuLen - 1) + 1) % menuLen);
      if (key.upArrow) return void setSelected((s) => (Math.min(s, menuLen - 1) - 1 + menuLen) % menuLen);
      if (key.tab && !key.shift) {
        if (menuKind === "command") setInputEnd(`/${commandSuggestions[sel].name} `);
        else setInputEnd(`/model ${modelSuggestions[sel].ref}`);
        return;
      }
      if (key.escape) return void setInput("");
    }
    if (key.tab && key.shift) setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  });

  async function handleCommand(cmd: string): Promise<void> {
    const command = cmd.slice(1).trim();
    const separator = command.search(/\s/);
    const name = separator < 0 ? command : command.slice(0, separator);
    const rawArgs = separator < 0 ? "" : command.slice(separator).trim();
    const args = rawArgs ? rawArgs.split(/\s+/) : [];
    switch (name) {
      case "exit":
      case "quit":
        return exit();
      case "mode":
        if (args[0] && MODES.includes(args[0] as Mode)) setMode(args[0] as Mode);
        else sys(`modes: ${MODES.join(", ")} (current: ${mode})`);
        return;
      case "model":
        if (args[0]) {
          setModel(args[0]);
          sys(`model → ${args[0]}`);
        } else {
          sys(`model: ${model} · type "/model " then a name to pick (↑/↓, grouped by provider)`);
        }
        return;
      case "lang": {
        const code = args[0]?.toLowerCase();
        if (code === "off" || code === "none") {
          setLanguage(undefined);
          sys("Bharat Mode language off");
        } else if (code && code in LANGUAGE_LABELS) {
          setLanguage(code as LanguageCode);
          sys(`Bharat Mode: ${LANGUAGE_LABELS[code as LanguageCode]} (${code})`);
        } else {
          sys(`language: ${language ? `${LANGUAGE_LABELS[language]} (${language})` : "off"} · codes: ${Object.keys(LANGUAGE_LABELS).join(", ")}`);
        }
        return;
      }
      case "terse": {
        const on = args[0] ? args[0] === "on" : !terse;
        setTerse(on);
        sys(`Terse Mode ${on ? "ON — shortest complete responses" : "off"}`);
        return;
      }
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
      case "hooks": {
        try {
          const result = await getHooks(base);
          if (result.error) return sys(`hooks: invalid config — ${result.error}`);
          const rows = [
            ...result.hooks.preToolUse.map((h) => `  preToolUse [${h.matcher ?? "*"}] ${h.command}`),
            ...result.hooks.postToolUse.map((h) => `  postToolUse [${h.matcher ?? "*"}] ${h.command}`),
            ...result.hooks.onFinish.map((h) => `  onFinish ${h.command}`),
          ];
          sys(rows.length ? `hooks (${result.path}):` : `hooks: (none — ${result.path})`);
          rows.forEach(sys);
        } catch {
          sys("hooks: (server unreachable)");
        }
        return;
      }
      case "setup": {
        try {
          const apply = args[0] === "apply";
          const result = await runSetupScout(base, apply);
          sys(`Setup Scout: ${result.detected.languages.join(", ") || "unknown stack"}${result.detected.frameworks.length ? ` · ${result.detected.frameworks.join(", ")}` : ""}`);
          sys(`  recommends ${result.recommendations.mcpServers.length} MCP server(s), ${result.recommendations.skills.length} skill(s), and PERSONA.md`);
          if (apply) sys(result.applied.length ? `  applied: ${result.applied.join(", ")}` : "  nothing applied (files already exist)");
          else sys("  preview only — use /setup apply to create missing files");
        } catch (error) {
          sys(`Setup Scout failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      case "agent": {
        if (!rawArgs) {
          try {
            const agents = await getAgents(base);
            sys(`agent: ${agentName ?? "(none)"}`);
            agents.forEach(({ agent }) => sys(`  • ${agent.name} — ${agent.description}`));
          } catch {
            sys("agents: (server unreachable)");
          }
          return;
        }
        if (rawArgs === "off") {
          setAgentName(undefined);
          sys("custom agent off");
          return;
        }
        const deleteMatch = rawArgs.match(/^(?:delete|rm|remove)(?:\s+)([\s\S]+)$/);
        if (deleteMatch) {
          const target = deleteMatch[1]!.trim().replace(/^(["'])(.*)\1$/, "$2");
          try {
            await deleteAgent(base, target);
            if (agentName && agentName.toLowerCase() === target.toLowerCase()) setAgentName(undefined);
            sys(`agent deleted: ${target}`);
          } catch (error) {
            sys(`delete failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          return;
        }
        const useMatch = rawArgs.match(/^use(?:\s+)([\s\S]+)$/);
        if (useMatch) {
          const selected = useMatch[1]!.trim().replace(/^(["'])(.*)\1$/, "$2");
          setAgentName(selected);
          sys(`custom agent: ${selected}`);
          return;
        }
        const match = rawArgs.match(/^new(?:\s+)([\s\S]+)$/);
        if (!match) return sys('usage: /agent new "prompt" · /agent use "name" · /agent delete "name" · /agent off');
        let prompt = match[1]!.trim();
        if ((prompt.startsWith('"') && prompt.endsWith('"')) || (prompt.startsWith("'") && prompt.endsWith("'"))) {
          prompt = prompt.slice(1, -1).trim();
        }
        if (!prompt) return sys('usage: /agent new "describe the agent"');
        sys("building agent definition…");
        try {
          const result = await createAgent(base, prompt);
          sys(`agent created: ${result.agent.name} — ${result.agent.description} (${result.path})`);
        } catch (error) {
          sys(`agent creation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      case "research": {
        const on = args[0] ? args[0] === "on" : agentName !== "Deep Research";
        setAgentName(on ? "Deep Research" : undefined);
        sys(`Deep Research ${on ? "ON — iterative web search with citations" : "off"}`);
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
        sys('/init /setup [apply] /agent new|use|delete|off /research [on|off] /lang <code|off> /terse [on|off] /memory /skills /mcp /hooks /rewind [n] /usage /compact /crew [on|off] /pav [on|off] /mode <m> /model <ref> /connect /exit · Shift+Tab cycles modes · Esc interrupts');
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
          model: agentName || model.startsWith("(") ? undefined : model,
          mode: agentName ? undefined : mode,
          agent: agentName,
          language: language ?? null,
          terse,
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
          onFallback: (from, to) => {
            sys(`⇄ fallback: ${from} → ${to}`);
            setModel(to); // reflect the model that actually answered in the statusline
          },
          onOrchestration: (s) => {
            if (s.stage === "route") setModel(s.model);
            sys(`⚡ ${s.stage} ${s.model} — ${s.detail} · ${(s.ms / 1000).toFixed(1)}s`);
          },
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
          <TextInput
            key={inputKey}
            value={input}
            onChange={(v) => {
              setInput(v);
              setSelected(0);
            }}
            onSubmit={(v) => {
              // Enter with a menu open acts on the highlighted row.
              if (menuKind === "command") {
                const name = commandSuggestions[sel].name;
                setInput("");
                setSelected(0);
                void handleCommand(`/${name}`);
                return;
              }
              if (menuKind === "model") {
                const ref = modelSuggestions[sel].ref;
                setInput("");
                setSelected(0);
                setModel(ref);
                sys(`model → ${ref}`);
                return;
              }
              submit(v);
            }}
            placeholder="Message…  (type / for commands)"
          />
        </Box>
      )}

      {menuKind === "command" && !pendingPerm && (
        <Box flexDirection="column" paddingX={1}>
          {winStart > 0 && <Text dimColor>  ↑ {winStart} more</Text>}
          {commandSuggestions.slice(winStart, winStart + MENU_WINDOW).map((c, i) => {
            const idx = winStart + i;
            return (
              <Text key={c.name} color={idx === sel ? "magentaBright" : undefined} dimColor={idx !== sel}>
                {idx === sel ? "❯ " : "  "}/{c.name}
                {c.args ? ` ${c.args}` : ""}
                {"  —  "}
                {c.desc}
              </Text>
            );
          })}
          {menuLen > winStart + MENU_WINDOW && <Text dimColor>  ↓ {menuLen - winStart - MENU_WINDOW} more</Text>}
          <Text dimColor>↑/↓ select · Tab complete · Enter run · Esc dismiss</Text>
        </Box>
      )}

      {menuKind === "model" && !pendingPerm && (
        <Box flexDirection="column" paddingX={1}>
          {winStart > 0 && <Text dimColor>  ↑ {winStart} more</Text>}
          {modelSuggestions.slice(winStart, winStart + MENU_WINDOW).map((m, i) => {
            const idx = winStart + i;
            const prev = idx > 0 ? modelSuggestions[idx - 1] : undefined;
            const showHeader = !prev || prev.providerId !== m.providerId;
            return (
              <Box key={m.ref} flexDirection="column">
                {showHeader && <Text color="cyanBright" bold>{m.providerId}</Text>}
                <Text color={idx === sel ? "magentaBright" : undefined} dimColor={idx !== sel}>
                  {idx === sel ? "  ❯ " : "    "}{m.modelId}
                  {m.contextWindow ? <Text dimColor>{`  (${fmtNum(m.contextWindow)} ctx)`}</Text> : null}
                </Text>
              </Box>
            );
          })}
          {menuLen > winStart + MENU_WINDOW && <Text dimColor>  ↓ {menuLen - winStart - MENU_WINDOW} more</Text>}
          <Text dimColor>↑/↓ select · Tab fill · Enter set model · Esc dismiss</Text>
        </Box>
      )}

      <Box gap={2}>
        <Text dimColor>{model}</Text>
        <Text color={mode === "auto" ? "yellow" : mode === "plan" ? "blue" : "gray"}>{modeInfo.chip}</Text>
        {crew && <Text color="magentaBright">⚡ Crew</Text>}
        {pav && <Text color="greenBright">⚙ PAV</Text>}
        {agentName && <Text color="cyanBright">agent: {agentName}</Text>}
        {language && <Text color="cyan">BHARAT {language.toUpperCase()}</Text>}
        {terse && <Text color="yellow">TERSE</Text>}
        <Text dimColor>
          {fmtNum(tokens)}
          {ctxWindow > 0 ? `/${fmtNum(ctxWindow)} · ${ctxPct.toFixed(ctxPct < 10 ? 1 : 0)}%` : " tok"}
        </Text>
        <Text dimColor>Shift+Tab: mode</Text>
      </Box>
    </Box>
  );
}
