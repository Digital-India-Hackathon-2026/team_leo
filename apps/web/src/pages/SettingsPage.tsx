import { useEffect, useState } from "react";
import type { ProviderInfo, SetupScoutResponse } from "@personacode/contracts";

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

  const [setupScout, setSetupScout] = useState<SetupScoutResponse | null>(null);
  const [scouting, setScouting] = useState(false);
  const [applyingScout, setApplyingScout] = useState(false);

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    fetch("/api/mcp").then((r) => r.json()).then(setMcp).catch(() => {});
    fetch("/api/memory").then((r) => r.json()).then((d) => setMemories(d.memories ?? [])).catch(() => {});
    fetch("/api/skills").then((r) => r.json()).then((d) => setSkills(d.skills ?? [])).catch(() => {});
    fetch("/api/checkpoints").then((r) => r.json()).then((d) => setCheckpoints(d.checkpoints ?? [])).catch(() => {});
    runScout(false);
  }, []);

  async function runScout(apply: boolean) {
    if (apply) setApplyingScout(true);
    else setScouting(true);
    try {
      const res = await fetch("/api/setup-scout", {
        method: apply ? "POST" : "GET",
        headers: apply ? { "content-type": "application/json" } : undefined,
        body: apply ? JSON.stringify({ apply: true }) : undefined,
      });
      if (res.ok) {
        setSetupScout(await res.json());
      }
    } catch { /* ignore */ }
    if (apply) setApplyingScout(false);
    else setScouting(false);
  }

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

      {/* Setup Scout */}
      <section className="settings-section scout-section">
        <div className="scout-header">
          <h3>🔍 Setup Scout</h3>
          <button className="scout-refresh-btn" onClick={() => runScout(false)} disabled={scouting || applyingScout}>
            {scouting ? "Scanning…" : "Rescan"}
          </button>
        </div>
        <p className="settings-hint">Automatically configures Personacode for this workspace.</p>
        
        {setupScout && (
          <div className="scout-content">
            <div className="scout-detected">
              <div className="settings-sub">Detected Stack</div>
              <div className="scout-chips">
                {setupScout.detected.languages.map((l) => <span key={l} className="scout-chip lang">{l}</span>)}
                {setupScout.detected.frameworks.map((f) => <span key={f} className="scout-chip fw">{f}</span>)}
                {setupScout.detected.packageManager && <span className="scout-chip pm">{setupScout.detected.packageManager}</span>}
                {setupScout.detected.scripts.map((s) => <span key={s} className="scout-chip script">{s}</span>)}
              </div>
            </div>

            {(setupScout.recommendations.mcpServers.length > 0 || setupScout.recommendations.skills.length > 0 || setupScout.recommendations.personaTemplate) && (
              <div className="scout-recs">
                <div className="settings-sub">Recommendations</div>
                <ul className="scout-recs-list">
                  {setupScout.recommendations.mcpServers.map((m) => (
                    <li key={m.name}><strong>MCP Server:</strong> {m.name} - {m.description}</li>
                  ))}
                  {setupScout.recommendations.skills.map((s) => (
                    <li key={s.name}><strong>Skill:</strong> {s.name} - {s.description}</li>
                  ))}
                  {setupScout.recommendations.personaTemplate && (
                    <li><strong>Persona:</strong> Project-specific instructions</li>
                  )}
                </ul>
                <button className="scout-apply-btn" onClick={() => runScout(true)} disabled={applyingScout}>
                  {applyingScout ? "Applying…" : "✨ Apply Recommendations"}
                </button>
              </div>
            )}

            {setupScout.applied.length > 0 && (
              <div className="scout-applied">
                <div className="settings-sub">Applied Successfully</div>
                <ul className="scout-applied-list">
                  {setupScout.applied.map((a) => <li key={a}>✓ {a}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

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
