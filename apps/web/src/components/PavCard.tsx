import { useState } from "react";
import type { PavStage } from "@personacode/contracts";
import MarkdownRenderer from "./MarkdownRenderer";

function phaseIcon(phase: string, passed?: boolean): string {
  if (phase === "plan") return "📋";
  if (phase === "apply") return "🔨";
  if (phase === "verify") return passed ? "✓" : "✗";
  if (phase === "done") return "🏁";
  return "⚙";
}

function phaseLabel(phase: string): string {
  if (phase === "plan") return "Plan";
  if (phase === "apply") return "Apply";
  if (phase === "verify") return "Verify";
  if (phase === "done") return "Done";
  return phase;
}

export default function PavCard({ stages }: { stages: PavStage[] }) {
  const [expandPlan, setExpandPlan] = useState(false);
  const [expandOutput, setExpandOutput] = useState<number | null>(null);

  if (stages.length === 0) return null;

  const last = stages[stages.length - 1];
  const isDone = last.phase === "done";
  const allPassed = isDone ? last.passed !== false : undefined;

  return (
    <div className={`pav-card ${isDone ? (allPassed ? "passed" : "failed") : "running"}`}>
      <div className="pav-head">
        <span className="pav-icon">⚙</span>
        <span className="pav-title">PAV Loop</span>
        {isDone && (
          <span className={`pav-result ${allPassed ? "pass" : "fail"}`}>
            {allPassed ? "✓ Passed" : "✗ Failed"}
          </span>
        )}
        {!isDone && <span className="pav-running">Running…</span>}
      </div>

      <div className="pav-timeline">
        {stages.map((s, i) => {
          const icon = phaseIcon(s.phase, s.passed);
          const isVerify = s.phase === "verify";
          const passed = isVerify ? s.passed : undefined;

          return (
            <div key={i} className={`pav-step ${s.phase} ${isVerify ? (passed ? "pass" : "fail") : ""}`}>
              <div className="pav-step-dot">
                <span className={`pav-phase-icon ${isVerify ? (passed ? "pass" : "fail") : ""}`}>
                  {icon}
                </span>
                {i < stages.length - 1 && <div className="pav-step-line" />}
              </div>
              <div className="pav-step-content">
                <div className="pav-step-head">
                  <span className="pav-step-label">{phaseLabel(s.phase)}</span>
                  {s.iteration != null && <span className="pav-iter">#{s.iteration}</span>}
                  {s.model && <span className="pav-model">{s.model.split("/").pop()}</span>}
                  {s.ms != null && <span className="pav-ms">{(s.ms / 1000).toFixed(1)}s</span>}
                </div>
                <div className="pav-step-detail">{s.detail}</div>

                {/* Plan phase: collapsible markdown */}
                {s.phase === "plan" && s.plan && (
                  <div className="pav-plan">
                    <button className="pav-expand" onClick={() => setExpandPlan((v) => !v)}>
                      {expandPlan ? "▾ Hide plan" : "▸ Show plan"}
                    </button>
                    {s.planPath && <span className="pav-path">{s.planPath}</span>}
                    {expandPlan && (
                      <div className="pav-plan-body">
                        <MarkdownRenderer text={s.plan} />
                      </div>
                    )}
                  </div>
                )}

                {/* Verify phase: command + collapsible output */}
                {s.phase === "verify" && s.command && (
                  <div className="pav-verify">
                    <code className="pav-cmd">$ {s.command}</code>
                    {s.output && (
                      <>
                        <button className="pav-expand" onClick={() => setExpandOutput(expandOutput === i ? null : i)}>
                          {expandOutput === i ? "▾ Hide output" : "▸ Show output"}
                        </button>
                        {expandOutput === i && (
                          <pre className="pav-output">{s.output}</pre>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
