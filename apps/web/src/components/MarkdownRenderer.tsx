import { useState, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExtraProps } from "react-markdown";

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

export default function MarkdownRenderer({ text }: { text: string }) {
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
        {text}
      </ReactMarkdown>
    </div>
  );
}
