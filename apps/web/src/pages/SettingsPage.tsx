import { useEffect, useState } from "react";
import type { ProviderInfo } from "@personacode/contracts";

type McpTool = { name: string; server: string; description?: string };
type McpData = { servers: Array<{ name: string; status: string }>; tools: McpTool[] };
type MemoryItem = { name: string; description: string };
type SkillItem = { name: string; description: string };
type Checkpoint = { hash: string; message: string; date: string };

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [mcp, setMcp] = useState<McpData | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    fetch("/api/mcp").then((r) => r.json()).then(setMcp).catch(() => {});
    fetch("/api/memory").then((r) => r.json()).then((d) => setMemories(d.memories ?? [])).catch(() => {});
    fetch("/api/skills").then((r) => r.json()).then((d) => setSkills(d.skills ?? [])).catch(() => {});
    fetch("/api/checkpoints").then((r) => r.json()).then((d) => setCheckpoints(d.checkpoints ?? [])).catch(() => {});
  }, []);

  async function restore(hash: string) {
    setRestoring(hash);
    try {
      await fetch("/api/checkpoints/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash }),
      });
    } catch { /* ignore */ }
    setRestoring(null);
  }

  const badgeClass = (badge: string) =>
    badge === "free" ? "badge-free" : badge === "freemium" ? "badge-freemium" : "badge-local";

  return (
    <div className="settings-page">
      <h2>⚙ Settings</h2>

      {/* Providers */}
      <section className="settings-section">
        <h3>Providers</h3>
        <p className="settings-hint">API keys live in <code>.env</code> on the server. This page shows what's configured.</p>
        <div className="provider-grid">
          {providers.map((p) => (
            <div key={p.id} className={`provider-card ${p.configured ? "configured" : "unconfigured"}`}>
              <div className="provider-top">
                <span className="provider-name">{p.name}</span>
                <span className={`provider-badge ${badgeClass(p.badge)}`}>{p.badge}</span>
              </div>
              <div className="provider-status">
                {p.configured ? <span className="status-ok">✅ Configured</span> : <span className="status-no">❌ Not configured</span>}
                {p.coolingDownUntil && p.coolingDownUntil > Date.now() && (
                  <span className="status-cool">⏳ Cooling down</span>
                )}
              </div>
              <p className="provider-quota">{p.quotaNote}</p>
              <a className="provider-key-link" href={p.keyUrl} target="_blank" rel="noopener noreferrer">
                Get API Key →
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* MCP */}
      {mcp && (
        <section className="settings-section">
          <h3>MCP Servers</h3>
          {mcp.servers.length === 0 && mcp.tools.length === 0 ? (
            <p className="settings-empty">No MCP servers configured. Add them in <code>.personacode/mcp.json</code>.</p>
          ) : (
            <>
              {mcp.servers.length > 0 && (
                <div className="mcp-servers">
                  {mcp.servers.map((s) => (
                    <div key={s.name} className="mcp-server">
                      <span className="mcp-name">{s.name}</span>
                      <span className={`mcp-status ${s.status}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {mcp.tools.length > 0 && (
                <div className="mcp-tools">
                  <div className="settings-sub">Tools ({mcp.tools.length})</div>
                  {mcp.tools.map((t) => (
                    <div key={t.name} className="mcp-tool">
                      <span className="mcp-tool-name">{t.name}</span>
                      {t.description && <span className="mcp-tool-desc">{t.description}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Memory & Skills */}
      <section className="settings-section">
        <h3>Memory & Skills</h3>
        <div className="ms-grid">
          <div>
            <div className="settings-sub">Memory files ({memories.length})</div>
            {memories.length === 0 ? (
              <p className="settings-empty">No memory files. They'll appear in <code>.personacode/memory/</code>.</p>
            ) : (
              memories.map((m) => (
                <div key={m.name} className="ms-item">
                  <span className="ms-name">{m.name}</span>
                  <span className="ms-desc">{m.description}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="settings-sub">Skills ({skills.length})</div>
            {skills.length === 0 ? (
              <p className="settings-empty">No skills loaded.</p>
            ) : (
              skills.map((s) => (
                <div key={s.name} className="ms-item">
                  <span className="ms-name">{s.name}</span>
                  <span className="ms-desc">{s.description}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Checkpoints */}
      <section className="settings-section">
        <h3>Checkpoints</h3>
        {checkpoints.length === 0 ? (
          <p className="settings-empty">No checkpoints yet. They're created automatically before file-modifying turns.</p>
        ) : (
          <div className="checkpoint-list">
            {checkpoints.map((cp) => (
              <div key={cp.hash} className="checkpoint">
                <div className="checkpoint-info">
                  <span className="checkpoint-msg">{cp.message}</span>
                  <span className="checkpoint-date">{cp.date}</span>
                </div>
                <button
                  className="checkpoint-restore"
                  onClick={() => restore(cp.hash)}
                  disabled={restoring === cp.hash}
                >
                  {restoring === cp.hash ? "Restoring…" : "↩ Restore"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
