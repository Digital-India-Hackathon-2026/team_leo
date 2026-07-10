import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { UIMessage } from "ai";
import type { Mode } from "@personacode/contracts";
import { MODE_LABELS } from "@personacode/contracts";
import { contextWindowFor, defaultModelRef, isMockMode, runAgentTurn } from "@personacode/core";

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

export default function App() {
  const { exit } = useApp();
  const [lines, setLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("default");
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [model, setModel] = useState<string>(() => {
    try {
      return defaultModelRef();
    } catch {
      return "(no provider — run /connect or set PERSONACODE_MOCK=1)";
    }
  });

  useInput((_input, key) => {
    if (key.escape && busy) {
      // Day 1: wire an AbortController through runAgentTurn
      setLines((l) => [...l, { role: "system", text: "(interrupt lands on Day 1)" }]);
    }
    if (key.tab && key.shift) {
      setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
    }
  });

  function handleCommand(cmd: string): boolean {
    const [name, ...args] = cmd.slice(1).split(" ");
    switch (name) {
      case "exit":
      case "quit":
        exit();
        return true;
      case "mode":
        if (args[0] && MODES.includes(args[0] as Mode)) setMode(args[0] as Mode);
        else setLines((l) => [...l, { role: "system", text: `modes: ${MODES.join(", ")}` }]);
        return true;
      case "model":
        if (args[0]) setModel(args[0]);
        else setLines((l) => [...l, { role: "system", text: `model: ${model}` }]);
        return true;
      case "help":
        setLines((l) => [
          ...l,
          {
            role: "system",
            text: "/mode <m> · /model <ref> · /exit · Shift+Tab cycles modes. Full command set lands Days 1-2.",
          },
        ]);
        return true;
      default:
        setLines((l) => [...l, { role: "system", text: `Unknown command: /${name}` }]);
        return true;
    }
  }

  async function submit(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    setInput("");
    if (text.startsWith("/")) {
      handleCommand(text);
      return;
    }

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    const messages = [...history, userMsg];
    setHistory(messages);
    setLines((l) => [...l, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);

    try {
      const stream = runAgentTurn({
        messages,
        modelRef: model.startsWith("(") ? undefined : model,
        mode,
        onFinishTurn: ({ text: reply, usage, modelRef }) => {
          setTokens((t) => t + usage.totalTokens);
          setModel(modelRef);
          setHistory((h) => [
            ...h,
            { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: reply }] },
          ]);
        },
        onFallback: (from, to) =>
          setLines((l) => [...l, { role: "system", text: `⇄ fallback: ${from} → ${to}` }]),
      });

      for await (const chunk of stream as unknown as AsyncIterable<Record<string, unknown>>) {
        if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
          const delta = chunk.delta;
          setLines((l) => {
            const copy = [...l];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], text: copy[i].text + delta };
                break;
              }
            }
            return copy;
          });
        } else if (chunk.type === "error") {
          setLines((l) => [...l, { role: "system", text: `✖ ${String(chunk.errorText)}` }]);
        }
      }
    } catch (err) {
      setLines((l) => [...l, { role: "system", text: `✖ ${String((err as Error).message)}` }]);
    } finally {
      setBusy(false);
    }
  }

  const modeInfo = MODE_LABELS[mode];
  const ctxWindow = model.startsWith("(") ? 0 : contextWindowFor(model);
  const ctxPct = ctxWindow > 0 ? (tokens / ctxWindow) * 100 : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="magentaBright">◆ Personacode</Text>
        {isMockMode() && <Text color="yellow">  [MOCK]</Text>}
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

      <Box borderStyle="round" borderColor={mode === "auto" ? "yellow" : "gray"} paddingX={1}>
        <Text color="magentaBright">❯ </Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Message… (/help)" />
      </Box>

      <Box gap={2}>
        <Text dimColor>{model}</Text>
        <Text color={mode === "auto" ? "yellow" : mode === "plan" ? "blue" : "gray"}>
          {modeInfo.chip}
        </Text>
        <Text dimColor>
          {fmtNum(tokens)}
          {ctxWindow > 0 ? `/${fmtNum(ctxWindow)} · ${ctxPct.toFixed(ctxPct < 10 ? 1 : 0)}%` : " tok"}
        </Text>
        <Text dimColor>Shift+Tab: mode</Text>
      </Box>
    </Box>
  );
}
