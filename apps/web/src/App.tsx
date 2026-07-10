import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ModelInfo, Mode, SessionMeta } from "@personacode/contracts";

const MODES: Mode[] = ["default", "plan", "auto", "edit"];

export default function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [model, setModel] = useState<string>();
  const [mode, setMode] = useState<Mode>("default");
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ sessionId, model, mode }),
      }),
    [sessionId, model, mode]
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then(setSessions);
    fetch("/api/models")
      .then((r) => r.json())
      .then((m: ModelInfo[]) => {
        setModels(m);
        if (m.length) setModel((prev) => prev ?? m[0].ref);
      });
  }, []);

  async function newSession() {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, mode }),
    });
    const meta: SessionMeta = await res.json();
    setSessions((s) => [meta, ...s]);
    setSessionId(meta.id);
    setMessages([]);
  }

  async function openSession(id: string) {
    const s = await fetch(`/api/sessions/${id}`).then((r) => r.json());
    setSessionId(id);
    setModel(s.model);
    setMode(s.mode);
    setMessages(s.messages ?? []);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || status === "streaming") return;
    void (sessionId ? Promise.resolve() : newSession()).then(() => sendMessage({ text: input }));
    setInput("");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">◆ Personacode</div>
        <button className="new" onClick={newSession}>+ New session</button>
        <nav>
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session ${s.id === sessionId ? "active" : ""}`}
              onClick={() => openSession(s.id)}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      <main className="chat">
        <header className="topbar">
          <select value={model ?? ""} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.ref} value={m.ref}>{m.ref}</option>
            ))}
          </select>
          <div className="modes">
            {MODES.map((m) => (
              <button key={m} className={`mode ${m} ${m === mode ? "on" : ""}`} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
          {mode === "auto" && <span className="warn">⚠ AUTO — runs commands without asking</span>}
          {mode === "plan" && <span className="info">⏸ PLAN — read-only</span>}
        </header>

        <div className="messages">
          {messages.length === 0 && (
            <div className="empty">
              <h1>What are we building?</h1>
              <p>Multi-provider agent · free forever · private by default</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.parts.map((part, i) => {
                if (part.type === "text") return <div key={i} className="text">{part.text}</div>;
                if (part.type === "data-fallback") {
                  const d = (part as { data?: { from?: string; to?: string } }).data;
                  return (
                    <div key={i} className="fallback">⇄ provider fallback: {d?.from} → {d?.to}</div>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return <div key={i} className="tool">🔧 {part.type.replace("tool-", "")}</div>;
                }
                return null;
              })}
            </div>
          ))}
          {status === "streaming" && <div className="typing">…</div>}
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Personacode…"
            autoFocus
          />
          <button disabled={status === "streaming"}>Send</button>
        </form>
      </main>
    </div>
  );
}
