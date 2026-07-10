import { useState } from "react";

interface ToolPart {
  type: string;
  toolInvocation?: {
    toolName?: string;
    args?: unknown;
    result?: unknown;
    state?: string;
  };
  [key: string]: unknown;
}

function toolName(part: ToolPart): string {
  return part.toolInvocation?.toolName ?? part.type.replace("tool-", "");
}

function toolState(part: ToolPart): string {
  return part.toolInvocation?.state ?? "";
}

function formatJson(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

export default function ToolCallCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const name = toolName(part);
  const state = toolState(part);
  const args = part.toolInvocation?.args;
  const result = part.toolInvocation?.result;
  const hasBody = args != null || result != null;

  const stateIcon =
    state === "result" ? "✓" :
    state === "call" ? "⏳" :
    state === "partial-call" ? "⏳" :
    "🔧";

  return (
    <div className={`tool-card ${open ? "open" : ""}`}>
      <button className="tool-card-head" onClick={() => hasBody && setOpen((o) => !o)}>
        <span className="tool-card-icon">{stateIcon}</span>
        <span className="tool-card-name">{name}</span>
        {hasBody && <span className={`tool-card-caret ${open ? "expanded" : ""}`}>▸</span>}
      </button>
      {open && hasBody && (
        <div className="tool-card-body">
          {args != null && (
            <div className="tool-card-section">
              <div className="tool-card-label">Input</div>
              <pre className="tool-card-pre">{formatJson(args)}</pre>
            </div>
          )}
          {result != null && (
            <div className="tool-card-section">
              <div className="tool-card-label">Output</div>
              <pre className="tool-card-pre">{formatJson(result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
