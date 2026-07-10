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

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      const data: { agent: AgentDefinition; path: string }[] = await res.json();
      // Filter out agents the user has "deleted" (hidden via localStorage)
      const hidden: string[] = JSON.parse(localStorage.getItem("hidden-agents") ?? "[]");
      setAgents(data.filter((a) => !hidden.includes(a.agent.name)));
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
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) throw new Error("Failed to build agent");
      const data: CreateAgentResponse = await res.json();
      setAgents((prev) => [data, ...prev]);
      setPrompt("");
    } catch {
      setError("Failed to build agent from prompt.");
    } finally {
      setBuilding(false);
    }
  }

  async function deleteAgent(name: string) {
    setDeletingName(name);
    try {
      // Best-effort: try server delete (may not exist yet)
      await fetch(`/api/agents/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => {});
      // Always hide locally + persist in localStorage so it survives refreshes
      setAgents((prev) => prev.filter((a) => a.agent.name !== name));
      const hidden: string[] = JSON.parse(localStorage.getItem("hidden-agents") ?? "[]");
      if (!hidden.includes(name)) {
        hidden.push(name);
        localStorage.setItem("hidden-agents", JSON.stringify(hidden));
      }
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
