import { useState, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExtraProps } from "react-markdown";
import { useTypewriter } from "../hooks/useTypewriter";

function CodeBlock({ inline, className, children }: { inline?: boolean; className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";

  if (inline) {
    return <code className="md-inline-code">{children}</code>;
  }

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="md-code-block">
      <div className="md-code-head">
        {lang && <span className="md-lang">{lang}</span>}
        <button className="md-copy" onClick={copy} title="Copy code">
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      </div>
      <pre className="md-pre"><code>{text}</code></pre>
    </div>
  );
}

/**
 * During streaming, code fences may arrive unclosed (opening ``` without closing ```).
 * react-markdown won't render the code block at all in that case.
 * This helper detects unclosed fences and temporarily closes them for rendering.
 */
function fixUnclosedFences(md: string): string {
  const fenceRegex = /^(`{3,})/gm;
  let count = 0;
  let match;
  while ((match = fenceRegex.exec(md)) !== null) {
    count++;
  }
  // Odd number of fences = unclosed; append a closing fence
  if (count % 2 !== 0) {
    return md + "\n```";
  }
  return md;
}

export default function MarkdownRenderer({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  // Smooth character-by-character reveal during streaming
  const displayed = useTypewriter(text, isStreaming);
  const safeText = fixUnclosedFences(displayed);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props: HTMLAttributes<HTMLElement> & ExtraProps) {
            const { className, children, node, ...rest } = props;
            const isInline = !className;
            return <CodeBlock inline={isInline} className={className}>{children}</CodeBlock>;
          },
        }}
      >
        {safeText}
      </ReactMarkdown>
    </div>
  );
}
