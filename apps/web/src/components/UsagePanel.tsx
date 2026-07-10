import { useEffect, useState } from "react";
import type { UsageReport } from "@personacode/contracts";

export default function UsagePanel({ sessionId }: { sessionId?: string }) {
  const [usage, setUsage] = useState<UsageReport | null>(null);

  useEffect(() => {
    if (!sessionId) { setUsage(null); return; }
    fetch(`/api/sessions/${sessionId}/usage`)
      .then((r) => r.json())
      .then((d) => {
        if (d.sessionId) setUsage(d);
      })
      .catch(() => {});
  }, [sessionId]);

  if (!sessionId) return <p className="ws-empty">Select a session to view usage.</p>;
  if (!usage) return <p className="ws-empty">Loading usage…</p>;

  const pct = Math.round(usage.contextPercent * 100);
  const barColor = pct > 85 ? "var(--warn)" : pct > 60 ? "#e8a838" : "var(--accent2)";

  return (
    <div className="usage-panel">
      <div className="usage-section">
        <div className="usage-label">Context Window</div>
        <div className="usage-bar-track">
          <div
            className="usage-bar-fill"
            style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
          />
        </div>
        <div className="usage-bar-text">{pct}% used</div>
      </div>

      <div className="usage-section">
        <div className="usage-label">Token Totals</div>
        <table className="usage-table">
          <tbody>
            <tr><td>Input</td><td className="usage-num">{usage.total.inputTokens.toLocaleString()}</td></tr>
            <tr><td>Output</td><td className="usage-num">{usage.total.outputTokens.toLocaleString()}</td></tr>
            <tr className="usage-total-row"><td>Total</td><td className="usage-num">{usage.total.totalTokens.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>

      {Object.keys(usage.byProvider).length > 0 && (
        <div className="usage-section">
          <div className="usage-label">By Provider</div>
          {Object.entries(usage.byProvider).map(([provider, u]) => (
            <div key={provider} className="usage-provider">
              <span className="usage-provider-name">{provider}</span>
              <span className="usage-provider-tokens">{u.totalTokens.toLocaleString()} tokens</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
