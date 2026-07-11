import { useEffect, useState } from "react";
import type { AgentDefinition, CreateAgentResponse } from "@personacode/contracts";

interface AgentsPageProps {
  onSelectAgent: (name: string, preferredModel?: string) => void;
}

const FREE_PROVIDERS = new Set(["google", "groq", "cerebras", "openrouter"]);

export default function AgentsPage({ onSelectAgent }: AgentsPageProps) {
  const [agents, setAgents] = useState<{ agent: AgentDefinition; path: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);

  // Optional per-agent delivery (Discord/Telegram/email) — creds stay server-side.
  const [deliveryChannel, setDeliveryChannel] = useState<"" | "discord" | "telegram" | "email">("");
  const [dcfg, setDcfg] = useState<Record<string, string>>({});
  const setField = (k: string, v: string) => setDcfg((p) => ({ ...p, [k]: v }));

  function buildDelivery(): Record<string, string> | undefined {
    if (deliveryChannel === "discord" && dcfg.webhookUrl?.trim())
      return { channel: "discord", webhookUrl: dcfg.webhookUrl.trim() };
    if (deliveryChannel === "telegram" && dcfg.botToken?.trim() && dcfg.chatId?.trim())
      return { channel: "telegram", botToken: dcfg.botToken.trim(), chatId: dcfg.chatId.trim() };
    if (deliveryChannel === "email" && dcfg.to?.trim())
      return {
        channel: "email",
        to: dcfg.to.trim(),
        ...(dcfg.smtpUser?.trim() ? { smtpUser: dcfg.smtpUser.trim() } : {}),
        ...(dcfg.smtpPass ? { smtpPass: dcfg.smtpPass } : {}),
      };
    return undefined;
  }

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      const data: { agent: AgentDefinition; path: string }[] = await res.json();
      setAgents(data);
    } catch {
      setError("Could not load agents. Backend might not be ready.");
    } finally {
      setLoading(false);
    }
  }

  async function buildAgent() {
    if (!prompt.trim() || building) return;
    setBuilding(true);
    setError("");
    try {
      const delivery = buildDelivery();
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), ...(delivery ? { delivery } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to build agent");
      }
      const data: CreateAgentResponse = await res.json();
      setAgents((prev) => [data, ...prev]);
      setPrompt("");
      setDeliveryChannel("");
      setDcfg({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build agent from prompt.");
    } finally {
      setBuilding(false);
    }
  }

  async function testDelivery(name: string) {
    setTestingName(name);
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/test-delivery`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `server responded ${res.status}`);
      }
      alert(`✅ Test message sent for "${name}".`);
    } catch (e) {
      setError(`Test delivery failed for "${name}": ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestingName(null);
    }
  }

  async function deleteAgent(name: string) {
    if (!confirm(`Delete agent "${name}"? This removes its definition file.`)) return;
    setDeletingName(name);
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `server responded ${res.status}`);
      }
      setAgents((prev) => prev.filter((a) => a.agent.name !== name));
    } catch (e) {
      setError(`Could not delete "${name}": ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingName(null);
    }
  }

  function selectAgent(agent: AgentDefinition) {
    // If the agent has a model set and it's from a free provider, use it
    // Otherwise pass undefined to let App.tsx pick the best free model
    const agentModel = agent.model;
    const isFreeModel = agentModel && FREE_PROVIDERS.has(agentModel.split("/")[0]);
    onSelectAgent(agent.name, isFreeModel ? agentModel : undefined);
  }

  return (
    <div className="agents-page">
      <div className="agents-header">
        <h2>🤖 Superagents</h2>
        <p className="agents-subtitle">
          Build custom agents tailored to specific tasks, workflows, or roles.
        </p>
      </div>

      <div className="agent-builder">
        <h3>Build a new agent</h3>
        <p className="agent-builder-hint">
          Describe what the agent should do. The system will automatically configure its instructions, tools, and model.
        </p>
        <div className="agent-form">
          <textarea
            className="agent-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., 'An agent that reviews pull requests for security vulnerabilities'..."
            rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); buildAgent(); } }}
          />
          <div className="agent-delivery">
            <label className="agent-delivery-label">
              📣 Deliver output to (optional — for scheduled agents):
            </label>
            <select
              className="agent-delivery-select"
              value={deliveryChannel}
              onChange={(e) => {
                setDeliveryChannel(e.target.value as typeof deliveryChannel);
                setDcfg({});
              }}
            >
              <option value="">No delivery (chat only)</option>
              <option value="discord">Discord (webhook)</option>
              <option value="telegram">Telegram (bot)</option>
              <option value="email">Email</option>
            </select>
            {deliveryChannel === "discord" && (
              <input
                className="agent-delivery-input"
                placeholder="Discord webhook URL (https://discord.com/api/webhooks/…)"
                value={dcfg.webhookUrl ?? ""}
                onChange={(e) => setField("webhookUrl", e.target.value)}
              />
            )}
            {deliveryChannel === "telegram" && (
              <>
                <input
                  className="agent-delivery-input"
                  placeholder="Bot token (from @BotFather)"
                  value={dcfg.botToken ?? ""}
                  onChange={(e) => setField("botToken", e.target.value)}
                />
                <input
                  className="agent-delivery-input"
                  placeholder="Chat ID (numeric or @channelname)"
                  value={dcfg.chatId ?? ""}
                  onChange={(e) => setField("chatId", e.target.value)}
                />
              </>
            )}
            {deliveryChannel === "email" && (
              <>
                <input
                  className="agent-delivery-input"
                  placeholder="Recipient email"
                  value={dcfg.to ?? ""}
                  onChange={(e) => setField("to", e.target.value)}
                />
                <input
                  className="agent-delivery-input"
                  placeholder="SMTP user (optional — else server EMAIL_USER)"
                  value={dcfg.smtpUser ?? ""}
                  onChange={(e) => setField("smtpUser", e.target.value)}
                />
                <input
                  className="agent-delivery-input"
                  type="password"
                  placeholder="SMTP app password (optional)"
                  value={dcfg.smtpPass ?? ""}
                  onChange={(e) => setField("smtpPass", e.target.value)}
                />
              </>
            )}
            {deliveryChannel && (
              <p className="agent-delivery-hint">
                Tip: add a schedule in your prompt (e.g. “every morning at 8am”) so it delivers automatically.
                Credentials are stored on the server only and never shown again.
              </p>
            )}
          </div>
          <button className="agent-build-btn" onClick={buildAgent} disabled={building || !prompt.trim()}>
            {building ? "⚙ Building…" : "✨ Build Agent"}
          </button>
        </div>
      </div>

      {error && <div className="agents-error">⚠ {error}</div>}

      <div className="agents-list-section">
        <h3>Saved Agents ({agents.length})</h3>
        {loading ? (
          <p className="agents-empty">Loading agents…</p>
        ) : agents.length === 0 ? (
          <p className="agents-empty">No agents built yet. Try building one above!</p>
        ) : (
          <div className="agents-grid">
            {agents.map(({ agent, path }) => (
              <div key={agent.name} className="agent-card">
                <div className="agent-card-header">
                  <h4>{agent.name}</h4>
                  <div className="agent-header-badges">
                    <span className="agent-mode-badge">{agent.mode}</span>
                    <button
                      className="agent-delete-btn"
                      title={`Delete "${agent.name}"`}
                      aria-label={`Delete agent ${agent.name}`}
                      onClick={() => deleteAgent(agent.name)}
                      disabled={deletingName === agent.name}
                    >
                      {deletingName === agent.name ? "…" : "✕"}
                    </button>
                  </div>
                </div>
                <p className="agent-desc">{agent.description}</p>
                <div className="agent-meta">
                  <div className="agent-stat">
                    <span>Model:</span> {agent.model || "Auto (free)"}
                  </div>
                  {agent.tools.length > 0 && (
                    <div className="agent-stat">
                      <span>Tools:</span> {agent.tools.join(", ")}
                    </div>
                  )}
                  {agent.channels.length > 0 && (
                    <div className="agent-stat">
                      <span>Channels:</span> {agent.channels.join(", ")}
                    </div>
                  )}
                  {agent.schedule && (
                    <div className="agent-stat">
                      <span>Schedule:</span> {agent.schedule}
                    </div>
                  )}
                  {agent.delivery && (
                    <div className="agent-stat">
                      <span>Delivers to:</span> {agent.delivery.channel}
                      {agent.delivery.target ? ` (${agent.delivery.target})` : ""}
                    </div>
                  )}
                </div>
                {agent.systemPrompt && (
                  <div className="agent-prompt-section">
                    <button
                      className="agent-prompt-toggle"
                      onClick={() => setExpandedPrompt(expandedPrompt === agent.name ? null : agent.name)}
                    >
                      {expandedPrompt === agent.name ? "▾ Hide instructions" : "▸ Show instructions"}
                    </button>
                    {expandedPrompt === agent.name && (
                      <pre className="agent-prompt-preview">{agent.systemPrompt}</pre>
                    )}
                  </div>
                )}
                <div className="agent-card-actions">
                  <span className="agent-path" title={path}>📁 {path.split(/[\\/]/).pop()}</span>
                  {agent.delivery && (
                    <button
                      className="agent-select-btn"
                      onClick={() => testDelivery(agent.name)}
                      disabled={testingName === agent.name}
                    >
                      {testingName === agent.name ? "…" : "📨 Test delivery"}
                    </button>
                  )}
                  <button className="agent-select-btn" onClick={() => selectAgent(agent)}>
                    💬 Chat with Agent
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
