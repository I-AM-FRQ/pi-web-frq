"use client";

import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyTextToClipboard } from "@/client/clipboard";

/** 块级代码：右上角复制按钮。 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    void copyTextToClipboard(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="code-block">
      <button type="button" className="code-block-copy" onClick={copy} aria-label="复制代码" title="复制代码">
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{content}</ReactMarkdown>
    </div>
  );
});
