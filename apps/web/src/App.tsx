import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ModelInfo, Mode, SessionMeta, PavStage } from "@personacode/contracts";
import { MODE_LABELS } from "@personacode/contracts";
import MarkdownRenderer from "./components/MarkdownRenderer";
import ToolCallCard from "./components/ToolCallCard";
import PavCard from "./components/PavCard";
import UsagePanel from "./components/UsagePanel";
import ThemePicker from "./components/ThemePicker";
import ComparePage from "./pages/ComparePage";
import SettingsPage from "./pages/SettingsPage";
import NotesPage from "./pages/NotesPage";
import TasksPage from "./pages/TasksPage";
import GalleryPage from "./pages/GalleryPage";
import CookbookPage from "./pages/CookbookPage";
import AgentsPage from "./pages/AgentsPage";
import { timeAgo } from "./utils/timeAgo";

type AppView = "chat" | "compare" | "settings" | "notes" | "tasks" | "gallery" | "cookbook" | "agents";

const MODES: Mode[] = ["default", "plan", "auto", "edit"];
const MODE_META: Record<Mode, { label: string; hint: string; tone: "" | "plan" | "auto" | "edit" }> = {
  default: { label: "Default", hint: "Asks before risky actions", tone: "" },
  plan: { label: "Plan", hint: "Read-only — investigates and plans", tone: "plan" },
  auto: { label: "Auto", hint: "Runs commands without asking", tone: "auto" },
  edit: { label: "Edit", hint: "Edits files, never runs the shell", tone: "edit" },
};

type FileNode = { name: string; path: string; type: "dir" | "file"; size?: number; children?: FileNode[] };
type WsTab = "files" | "artifacts" | "todos" | "usage";

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
  const [view, setView] = useState<AppView>("chat");

  const [tree, setTree] = useState<FileNode[]>([]);
  const [wsRoot, setWsRoot] = useState("workspace");
  const [wsOpen, setWsOpen] = useState(true);
  const [wsTab, setWsTab] = useState<WsTab>("files");
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [crew, setCrew] = useState(false);
  const [pav, setPav] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Answered tool-permission requests: id → the decision taken (hides the buttons).
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const prevStatus = useRef<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Live token consumption counter
  const [liveTokens, setLiveTokens] = useState<{ input: number; output: number; total: number } | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const streamStartRef = useRef<number>(0);

  async function decide(id: string, decision: "allow" | "deny" | "always") {
    setAnswered((a) => ({ ...a, [id]: decision }));
    await fetch("/api/permission", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    }).catch(() => {});
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  // Copy full text of a message to clipboard.
  const copyMessage = useCallback((id: string, parts: Array<{ type: string; text?: string }>) => {
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }, []);

  // Delete a session.
  async function deleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((s) => s.filter((x) => x.id !== id));
    if (sessionId === id) {
      setSessionId(undefined);
      setMessages([]);
    }
  }

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ sessionId, model, mode, orchestrate: crew, pav, approvals: true, agent: activeAgent ?? undefined }),
      }),
    [sessionId, model, mode, crew, pav, activeAgent]
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

  // Auto-scroll: use requestAnimationFrame during streaming for smooth continuous scroll
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (status === "streaming") {
      const tick = () => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    } else {
      // One final scroll when streaming ends
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [status]);

  // Also scroll when messages array changes (new user message, session switch)
  useEffect(() => {
    if (status !== "streaming") {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, status]);

  // Refresh sessions list after streaming completes (fixes "New session" title bug).
  useEffect(() => {
    if (prevStatus.current === "streaming" && status !== "streaming") {
      fetch("/api/sessions").then((r) => r.json()).then(setSessions).catch(() => {});
      // Fetch real token usage after streaming ends — keep visible (no auto-fade)
      if (sessionId) {
        fetch(`/api/sessions/${sessionId}/usage`)
          .then((r) => r.json())
          .then((u) => {
            if (u.total) setLiveTokens({ input: u.total.inputTokens, output: u.total.outputTokens, total: u.total.totalTokens });
          })
          .catch(() => {});
      }
    }
    prevStatus.current = status;
  }, [status, sessionId]);

  // Live token estimation during streaming
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    if (status === "streaming") {
      streamStartRef.current = Date.now();
      setStreamElapsed(0);
      setLiveTokens(null); // Reset for new stream
      const interval = setInterval(() => {
        setStreamElapsed(Math.floor((Date.now() - streamStartRef.current) / 1000));
        // Use ref to avoid stale closure
        const msgs = messagesRef.current;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role === "assistant") {
          const textLen = lastMsg.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => acc + ((p as { text: string }).text?.length ?? 0), 0);
          const estimatedOutput = Math.max(1, Math.round(textLen / 4));
          const userTextLen = msgs
            .filter((m) => m.role === "user")
            .reduce((acc, m) => acc + m.parts.filter((p) => p.type === "text").reduce((a2, p) => a2 + ((p as { text: string }).text?.length ?? 0), 0), 0);
          const estimatedInput = Math.max(1, Math.round(userTextLen / 4));
          setLiveTokens({
            input: estimatedInput,
            output: estimatedOutput,
            total: estimatedInput + estimatedOutput,
          });
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [status]);

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
    setLiveTokens(null); // Clear previous token count
    void (sessionId ? Promise.resolve() : newSession()).then(() => sendMessage({ text }));
  }

  const modeTone = MODE_META[mode].tone;

  return (
    <div className={`app ${wsOpen ? "" : "ws-closed"}`}>
      {/* mobile hamburger */}
      <button className="hamburger" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((v) => !v)}>
        {sidebarOpen ? "✕" : "☰"}
      </button>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      {/* ---------------- sessions rail ---------------- */}
      <aside className={`rail ${sidebarOpen ? "open" : ""}`}>
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
              <div className="s-info">
                <span className="s-title">{s.title}</span>
                <span className="s-time">{timeAgo(s.updatedAt)}</span>
              </div>
              <button
                className="s-delete"
                title="Delete session"
                aria-label="Delete session"
                onClick={(e) => deleteSession(e, s.id)}
              >
                ✕
              </button>
            </button>
          ))}
        </nav>
        <div className="rail-nav">
          <button className={`rail-link ${view === "chat" ? "on" : ""}`} onClick={() => setView("chat")}>◇ Chat</button>
          <button className={`rail-link ${view === "compare" ? "on" : ""}`} onClick={() => setView("compare")}>⇌ Compare</button>
          <button className={`rail-link ${view === "notes" ? "on" : ""}`} onClick={() => setView("notes")}>📝 Notes</button>
          <button className={`rail-link ${view === "tasks" ? "on" : ""}`} onClick={() => setView("tasks")}>☑ Tasks</button>
          <button className={`rail-link ${view === "gallery" ? "on" : ""}`} onClick={() => setView("gallery")}>🖼 Gallery</button>
          <button className={`rail-link ${view === "cookbook" ? "on" : ""}`} onClick={() => setView("cookbook")}>📖 Cookbook</button>
          <button className={`rail-link ${view === "agents" ? "on" : ""}`} onClick={() => setView("agents")}>🤖 Agents</button>
          <button className={`rail-link ${view === "settings" ? "on" : ""}`} onClick={() => setView("settings")}>⚙ Settings</button>
        </div>
        <ThemePicker />
        <div className="rail-foot">Free-first · private · multi-provider</div>
      </aside>

      {/* ---------------- main content ---------------- */}
      {view !== "chat" ? (
        <main className="chat">
          {view === "compare" && <ComparePage />}
          {view === "notes" && <NotesPage />}
          {view === "tasks" && <TasksPage />}
          {view === "gallery" && <GalleryPage />}
          {view === "cookbook" && <CookbookPage />}
          {view === "agents" && (
            <AgentsPage
              onSelectAgent={(name) => {
                setActiveAgent(name);
                setView("chat");
              }}
            />
          )}
          {view === "settings" && <SettingsPage />}
        </main>
      ) : (
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
          <button
            className={`share-btn ${shareUrl ? "copied" : ""}`}
            disabled={!sessionId}
            onClick={async () => {
              if (!sessionId) return;
              try {
                const res = await fetch(`/api/share/${sessionId}`, { method: "POST" });
                const { url } = await res.json();
                const fullUrl = `${location.origin}${url}`;
                await navigator.clipboard.writeText(fullUrl);
                setShareUrl(fullUrl);
                setTimeout(() => setShareUrl(null), 3000);
              } catch { /* ignore */ }
            }}
          >
            {shareUrl ? "✓ Copied link" : "⛓ Share"}
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
                  <div className="who-row">
                    <span className="who">{m.role === "user" ? "You" : "Personacode"}</span>
                    {(m as unknown as { createdAt?: string | number }).createdAt && <span className="msg-time">{timeAgo(new Date((m as unknown as { createdAt: string | number }).createdAt).getTime())}</span>}
                    <button
                      className={`copy-btn ${copiedId === m.id ? "copied" : ""}`}
                      title="Copy message"
                      aria-label="Copy message"
                      onClick={() => copyMessage(m.id, m.parts as Array<{ type: string; text?: string }>)}
                    >
                      {copiedId === m.id ? "✓" : "📋"}
                    </button>
                  </div>
                  <div className="bubble">
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        const isLastAssistant =
                          m.role === "assistant" && messages.indexOf(m) === messages.length - 1;
                        return m.role === "assistant" ? (
                          <MarkdownRenderer
                            key={i}
                            text={(part as { text: string }).text}
                            isStreaming={isLastAssistant && status === "streaming"}
                          />
                        ) : (
                          <div key={i} className="text">
                            {(part as { text: string }).text}
                          </div>
                        );
                      }
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
                      if (part.type === "data-compaction") {
                        return (
                          <div key={i} className="chip compaction">
                            ✂ History auto-compacted to fit context window
                          </div>
                        );
                      }
                      if (part.type === "data-pav") {
                        // Only render PavCard once (on the first data-pav part)
                        if (i > 0 && m.parts.slice(0, i).some((p) => p.type === "data-pav")) {
                          return null;
                        }
                        // Collect ALL pav stages from this message
                        const pavStages: PavStage[] = m.parts
                          .filter((p) => p.type === "data-pav")
                          .map((p) => (p as { data?: PavStage }).data as PavStage);
                        return <PavCard key={i} stages={pavStages} />;
                      }
                      if (part.type === "data-permission-request") {
                        const d = (part as { data?: { id?: string; tool?: string; input?: unknown } }).data;
                        const id = d?.id ?? "";
                        const chosen = answered[id];
                        const summary =
                          (d?.input as { command?: string; path?: string })?.command ??
                          (d?.input as { path?: string })?.path ??
                          "";
                        return (
                          <div key={i} className="perm">
                            <div className="perm-head">
                              🔒 Allow <b>{d?.tool}</b>
                              {summary ? <code>{summary}</code> : null}?
                            </div>
                            {chosen ? (
                              <div className="perm-done">
                                {chosen === "deny" ? "✗ denied" : chosen === "always" ? "✓ always allowed" : "✓ allowed"}
                              </div>
                            ) : (
                              <div className="perm-actions">
                                <button className="perm-btn allow" onClick={() => decide(id, "allow")}>
                                  Allow
                                </button>
                                <button className="perm-btn always" onClick={() => decide(id, "always")}>
                                  Always
                                </button>
                                <button className="perm-btn deny" onClick={() => decide(id, "deny")}>
                                  Deny
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (part.type.startsWith("tool-"))
                        return <ToolCallCard key={i} part={part as { type: string; toolInvocation?: { toolName?: string; args?: unknown; result?: unknown; state?: string } }} />;
                      return null;
                    })}
                  </div>
                  {/* Token counter below the last assistant message */}
                  {m.role === "assistant" && messages.indexOf(m) === messages.length - 1 && liveTokens && (
                    <div className={`token-counter ${status === "streaming" ? "streaming" : "final"}`}>
                      <div className="token-counter-inner">
                        <span className="token-counter-icon">{status === "streaming" ? "⟳" : "◈"}</span>
                        <span className="token-counter-item">
                          <span className="token-label">In</span>
                          <span className="token-value">{liveTokens.input.toLocaleString()}</span>
                        </span>
                        <span className="token-sep">·</span>
                        <span className="token-counter-item">
                          <span className="token-label">Out</span>
                          <span className="token-value out">{liveTokens.output.toLocaleString()}</span>
                        </span>
                        <span className="token-sep">·</span>
                        <span className="token-counter-item">
                          <span className="token-label">Total</span>
                          <span className="token-value total">{liveTokens.total.toLocaleString()}</span>
                        </span>
                        {status === "streaming" && (
                          <>
                            <span className="token-sep">·</span>
                            <span className="token-elapsed">{streamElapsed}s</span>
                          </>
                        )}
                        {status !== "streaming" && <span className="token-final-badge">✓ final</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            {status === "streaming" && (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
              <div className="turn assistant">
                <div className="who-row">
                  <span className="who">Personacode</span>
                  {model && <span className="streaming-model">using {shortModel(model)}</span>}
                </div>
                <div className="bubble">
                  <span className="cursor" role="status" aria-label="Generating response" />
                </div>
              </div>
            )}
          </div>
        </div>


        {modeTone && (
          <div className={`mode-banner ${modeTone}`}>
            {MODE_LABELS[mode].chip}
          </div>
        )}

        {/* ---------------- composer ---------------- */}
        <div className="composer">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-grow textarea
              const ta = e.target;
              ta.style.height = "auto";
              ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
                // Reset height after send
                if (textareaRef.current) {
                  textareaRef.current.style.height = "auto";
                }
              }
            }}
            placeholder="Message Personacode…  (Enter to send, Shift+Enter for a new line)"
            rows={1}
          />
          <div className="controls">
            <button className="ctl icon" title="Attach (coming soon)" disabled>
              📎
            </button>
            {activeAgent && (
              <button
                className="ctl active-agent-btn"
                title="Active superagent. Click to clear."
                onClick={() => setActiveAgent(null)}
              >
                🤖 {activeAgent} ✕
              </button>
            )}
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
            <button
              className={`ctl toggle${pav ? " on" : ""}`}
              title="PAV Loop — Plan → Apply → Verify: iterative coding with verification"
              onClick={() => setPav((v) => !v)}
            >
              ⚙ PAV
            </button>
            <div className="spacer" />
            <button className="send" onClick={send} disabled={status === "streaming" || !input.trim()}>
              {status === "streaming" ? "…" : "↑"}
            </button>
          </div>
        </div>
      </main>
      )}

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
            {(["files", "artifacts", "todos", "usage"] as WsTab[]).map((t) => (
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
            {wsTab === "usage" && (
              <UsagePanel sessionId={sessionId} />
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
