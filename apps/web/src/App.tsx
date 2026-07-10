import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ModelInfo, Mode, SessionMeta } from "@personacode/contracts";

const MODES: Mode[] = ["default", "plan", "auto", "edit"];
const MODE_META: Record<Mode, { label: string; hint: string; tone: "" | "plan" | "auto" | "edit" }> = {
  default: { label: "Default", hint: "Asks before risky actions", tone: "" },
  plan: { label: "Plan", hint: "Read-only — investigates and plans", tone: "plan" },
  auto: { label: "Auto", hint: "Runs commands without asking", tone: "auto" },
  edit: { label: "Edit", hint: "Edits files, never runs the shell", tone: "edit" },
};

type FileNode = { name: string; path: string; type: "dir" | "file"; size?: number; children?: FileNode[] };
type WsTab = "files" | "artifacts" | "todos";

function shortModel(ref?: string): string {
  if (!ref) return "model";
  return ref.split("/").slice(1).join("/") || ref;
}
function fmtSize(n?: number): string {
  if (n == null) return "";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "M";
  if (n >= 1024) return Math.round(n / 1024) + "k";
  return String(n);
}

function FileTree({ nodes, depth, onOpen, active }: { nodes: FileNode[]; depth: number; onOpen: (p: string) => void; active?: string }) {
  return (
    <ul className="tree">
      {nodes.map((n) =>
        n.type === "dir" ? (
          <Dir key={n.path} node={n} depth={depth} onOpen={onOpen} active={active} />
        ) : (
          <li key={n.path}>
            <button
              className={`node file ${active === n.path ? "on" : ""}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onOpen(n.path)}
              title={n.path}
            >
              <span className="ico">›</span>
              <span className="nm">{n.name}</span>
              <span className="sz">{fmtSize(n.size)}</span>
            </button>
          </li>
        )
      )}
    </ul>
  );
}

function Dir({ node, depth, onOpen, active }: { node: FileNode; depth: number; onOpen: (p: string) => void; active?: string }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <button className="node dir" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>▸</span>
        <span className="nm">{node.name}</span>
      </button>
      {open && node.children && <FileTree nodes={node.children} depth={depth + 1} onOpen={onOpen} active={active} />}
    </li>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [model, setModel] = useState<string>();
  const [mode, setMode] = useState<Mode>("default");
  const [input, setInput] = useState("");

  const [tree, setTree] = useState<FileNode[]>([]);
  const [wsRoot, setWsRoot] = useState("workspace");
  const [wsOpen, setWsOpen] = useState(true);
  const [wsTab, setWsTab] = useState<WsTab>("files");
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [crew, setCrew] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", body: () => ({ sessionId, model, mode, orchestrate: crew }) }),
    [sessionId, model, mode, crew]
  );
  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then(setSessions).catch(() => {});
    fetch("/api/models")
      .then((r) => r.json())
      .then((m: ModelInfo[]) => {
        setModels(m);
        setModel((prev) => prev ?? m[0]?.ref);
      })
      .catch(() => {});
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => {
        setTree(d.tree ?? []);
        if (d.root) setWsRoot(d.root);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

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
    if (s.model) setModel(s.model);
    if (s.mode) setMode(s.mode);
    setMessages(s.messages ?? []);
  }

  async function openFile(path: string) {
    setWsTab("files");
    const d = await fetch(`/api/file?path=${encodeURIComponent(path)}`).then((r) => r.json());
    if (d.content != null) setPreview({ path, content: d.content });
  }

  function send() {
    if (!input.trim() || status === "streaming") return;
    const text = input;
    setInput("");
    void (sessionId ? Promise.resolve() : newSession()).then(() => sendMessage({ text }));
  }

  const modeTone = MODE_META[mode].tone;

  return (
    <div className={`app ${wsOpen ? "" : "ws-closed"}`}>
      {/* ---------------- sessions rail ---------------- */}
      <aside className="rail">
        <div className="brand">
          <span className="mark">◆</span> Personacode
        </div>
        <button className="new" onClick={newSession}>
          <span>＋</span> New session
        </button>
        <div className="rail-label">Chats</div>
        <nav className="sessions">
          {sessions.length === 0 && <p className="rail-empty">No sessions yet.</p>}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session ${s.id === sessionId ? "active" : ""}`}
              onClick={() => openSession(s.id)}
              title={s.title}
            >
              <span className="dot" />
              <span className="s-title">{s.title}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">Free-first · private · multi-provider</div>
      </aside>

      {/* ---------------- conversation ---------------- */}
      <main className="chat">
        <header className="chat-top">
          <div className="crumbs">
            <span className="ws-name">◇ {wsRoot}</span>
            <span className="sep">/</span>
            <span className="conv">{sessions.find((s) => s.id === sessionId)?.title ?? "New session"}</span>
          </div>
          <button className="ws-toggle" onClick={() => setWsOpen((o) => !o)}>
            {wsOpen ? "Hide workspace" : "Workspace"}
          </button>
        </header>

        <div className="stream" ref={scrollRef}>
          <div className="stream-inner">
            {messages.length === 0 ? (
              <div className="hello">
                <h1>What are we building?</h1>
                <p>
                  Any model, free or paid. Automatic fallback across providers. Runs on your machine — nothing
                  leaves it.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`turn ${m.role}`}>
                  <div className="who">{m.role === "user" ? "You" : "Personacode"}</div>
                  <div className="bubble">
                    {m.parts.map((part, i) => {
                      if (part.type === "text")
                        return (
                          <div key={i} className="text">
                            {part.text}
                          </div>
                        );
                      if (part.type === "data-fallback") {
                        const d = (part as { data?: { from?: string; to?: string } }).data;
                        return (
                          <div key={i} className="chip fallback">
                            ⇄ switched provider: {shortModel(d?.from)} → {shortModel(d?.to)}
                          </div>
                        );
                      }
                      if (part.type === "data-orchestration") {
                        const d = (part as { data?: { stage?: string; model?: string } }).data;
                        return (
                          <div key={i} className="chip crew">
                            ⚡ {d?.stage} · {shortModel(d?.model)}
                          </div>
                        );
                      }
                      if (part.type.startsWith("tool-"))
                        return (
                          <div key={i} className="chip tool">
                            🔧 {part.type.replace("tool-", "")}
                          </div>
                        );
                      return null;
                    })}
                  </div>
                </div>
              ))
            )}
            {status === "streaming" && (
              <div className="turn assistant">
                <div className="who">Personacode</div>
                <div className="bubble">
                  <span className="cursor" />
                </div>
              </div>
            )}
          </div>
        </div>

        {modeTone && (
          <div className={`mode-banner ${modeTone}`}>
            {mode === "auto" ? "⚠" : mode === "plan" ? "⏸" : "✎"} {MODE_META[mode].label} — {MODE_META[mode].hint}
          </div>
        )}

        {/* ---------------- composer ---------------- */}
        <div className="composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message Personacode…  (Enter to send, Shift+Enter for a new line)"
            rows={1}
          />
          <div className="controls">
            <button className="ctl icon" title="Attach (coming soon)" disabled>
              📎
            </button>
            <label className="ctl select">
              <span className="ctl-ico">◈</span>
              <select value={model ?? ""} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.ref} value={m.ref}>
                    {m.ref}
                  </option>
                ))}
              </select>
            </label>
            <label className={`ctl select mode ${modeTone}`}>
              <span className="ctl-ico">⛭</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_META[m].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`ctl toggle${crew ? " on" : ""}`}
              title="Model Crew — a fast scout gathers file context across free providers before the brain answers"
              onClick={() => setCrew((v) => !v)}
            >
              ⚡ Crew
            </button>
            <div className="spacer" />
            <button className="send" onClick={send} disabled={status === "streaming" || !input.trim()}>
              {status === "streaming" ? "…" : "↑"}
            </button>
          </div>
        </div>
      </main>

      {/* ---------------- workspace ---------------- */}
      {wsOpen && (
        <aside className="workspace">
          <div className="ws-head">
            <span className="ws-title">Workspace</span>
            <button className="ws-x" onClick={() => setWsOpen(false)} title="Hide">
              ✕
            </button>
          </div>
          <div className="ws-tabs">
            {(["files", "artifacts", "todos"] as WsTab[]).map((t) => (
              <button key={t} className={`ws-tab ${wsTab === t ? "on" : ""}`} onClick={() => setWsTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
                {t === "artifacts" && <span className="count">0</span>}
              </button>
            ))}
          </div>

          <div className="ws-body">
            {wsTab === "files" &&
              (tree.length ? (
                <FileTree nodes={tree} depth={0} onOpen={openFile} active={preview?.path} />
              ) : (
                <p className="ws-empty">No project files found.</p>
              ))}
            {wsTab === "artifacts" && (
              <p className="ws-empty">Artifacts the agent creates — reports, generated files, images — show up here.</p>
            )}
            {wsTab === "todos" && (
              <p className="ws-empty">Plan-mode steps and task lists will land here.</p>
            )}
          </div>

          {preview && wsTab === "files" && (
            <div className="preview">
              <div className="preview-head">
                <span className="p-path">{preview.path}</span>
                <button className="ws-x" onClick={() => setPreview(null)}>
                  ✕
                </button>
              </div>
              <pre className="preview-body">{preview.content}</pre>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
