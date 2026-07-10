import { useEffect, useState } from "react";
import type { ModelInfo, CompareResult } from "@personacode/contracts";
import MarkdownRenderer from "../components/MarkdownRenderer";

export default function ComparePage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((m: ModelInfo[]) => setModels(m))
      .catch(() => {});
  }, []);

  function toggle(ref: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(ref)) next.delete(ref);
      else if (next.size < 6) next.add(ref);
      return next;
    });
  }

  async function run() {
    if (selected.size < 2 || !prompt.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, models: [...selected] }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="compare-page">
      <div className="compare-header">
        <h2>⇌ Compare Models</h2>
        <p className="compare-hint">Send the same prompt to 2–6 models and see results side-by-side.</p>
      </div>

      <div className="compare-input">
        <textarea
          className="compare-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to compare across models…"
          rows={3}
        />
      </div>

      <div className="compare-models">
        <div className="compare-label">Select models (2–6):</div>
        <div className="compare-chips">
          {models.map((m) => (
            <button
              key={m.ref}
              className={`compare-chip ${selected.has(m.ref) ? "on" : ""}`}
              onClick={() => toggle(m.ref)}
            >
              <span className="compare-provider">{m.providerId}</span>
              <span className="compare-model-name">{m.modelId}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        className="compare-run"
        onClick={run}
        disabled={loading || selected.size < 2 || !prompt.trim()}
      >
        {loading ? "Comparing…" : `Compare ${selected.size} model${selected.size !== 1 ? "s" : ""}`}
      </button>

      {error && <div className="compare-error">⚠ {error}</div>}

      {loading && (
        <div className="compare-grid">
          {[...selected].map((ref) => (
            <div key={ref} className="compare-result skeleton">
              <div className="compare-result-head">{ref}</div>
              <div className="compare-result-body">
                <div className="skel-line" />
                <div className="skel-line short" />
                <div className="skel-line" />
              </div>
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="compare-grid">
          {results.map((r) => (
            <div key={r.model} className={`compare-result ${r.error ? "errored" : ""}`}>
              <div className="compare-result-head">
                <span className="compare-result-model">{r.model}</span>
              </div>
              <div className="compare-result-body">
                {r.error ? (
                  <div className="compare-result-error">⚠ {r.error}</div>
                ) : (
                  <MarkdownRenderer text={r.text} />
                )}
              </div>
              <div className="compare-result-foot">
                <span className="compare-badge time">⏱ {(r.ms / 1000).toFixed(1)}s</span>
                {r.usage && (
                  <span className="compare-badge tokens">
                    ◈ {r.usage.totalTokens} tokens
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
