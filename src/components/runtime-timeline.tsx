"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";

export type RuntimeTimelineItem =
  | { kind: "tool"; id: string; name: string; label: string; result?: string; isError: boolean; running: boolean }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string; isError?: boolean }
  | { kind: "status"; text: string; isError?: boolean }
  | { kind: "user"; content: string; timestamp?: string };

type RuntimeTimelineContentProps = {
  items: RuntimeTimelineItem[];
  isStreaming: boolean;
  modelName?: string;
  runLabel?: string;
  error?: string;
  executionLabel?: string;
  variant?: "streaming" | "completed" | "execution";
  scrollable?: boolean;
  className?: string;
  loading?: boolean;
  emptyText?: string;
};

function ExecutionCollapse({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="execution-collapse" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>{label}</summary>
      <div className="execution-collapse-body">{children}</div>
    </details>
  );
}

function ToolSteps({ tools }: { tools: Array<Extract<RuntimeTimelineItem, { kind: "tool" }>> }) {
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  if (tools.length === 0) return null;
  return (
    <div className="codex-tool-steps">
      {tools.map((tool) => {
        const parts = tool.label.split("·").map((part) => part.trim());
        const canExpand = !tool.running && tool.result !== undefined;
        const expanded = expandedToolIds.has(tool.id);
        const outputId = `tool-output-${tool.id}`;
        return (
          <div key={tool.id} className={`codex-tool-step${tool.isError ? " failed" : ""}${tool.running ? " running" : ""}${expanded ? " expanded" : ""}`}>
            <button
              type="button"
              className="codex-tool-trigger"
              disabled={!canExpand}
              aria-expanded={canExpand ? expanded : undefined}
              aria-controls={canExpand ? outputId : undefined}
              onClick={() => setExpandedToolIds((current) => {
                const next = new Set(current);
                if (next.has(tool.id)) next.delete(tool.id);
                else next.add(tool.id);
                return next;
              })}
            >
              <span className="codex-tool-bullet" aria-hidden="true">{tool.running ? <i className="codex-spinner" /> : tool.isError ? "✗" : "✓"}</span>
              <span className="codex-tool-name">{parts[0]}</span>
              {parts.length > 1 ? <span className="codex-tool-args">{parts.slice(1).join(" · ")}</span> : null}
              {canExpand ? <span className="codex-tool-disclosure" aria-hidden="true">{expanded ? "⌄" : "›"}</span> : null}
            </button>
            {expanded ? <pre id={outputId} className="codex-tool-output">{tool.result}</pre> : null}
          </div>
        );
      })}
    </div>
  );
}

function timeLabel(timestamp?: string) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function UserItem({ item }: { item: Extract<RuntimeTimelineItem, { kind: "user" }> }) {
  return <article className="user-message"><div className="message-body"><ChatMarkdown content={item.content} /></div>{item.timestamp ? <div className="user-message-meta"><time dateTime={item.timestamp}>{timeLabel(item.timestamp)}</time></div> : null}</article>;
}

function DirectItem({ item, modelName, runLabel, live }: { item: RuntimeTimelineItem; modelName?: string; runLabel?: string; live?: boolean }) {
  if (item.kind === "tool") return <ToolSteps tools={[item]} />;
  if (item.kind === "thinking") return <div className="thinking-content"><ChatMarkdown content={item.text} /></div>;
  if (item.kind === "user") return <UserItem item={item} />;
  if (item.kind === "status") return <p className={`runtime-timeline-status${item.isError ? " failed" : ""}`} role="status">{item.text}</p>;
  return <article className={`assistant-reply${live ? " live" : ""}${item.isError ? " failed" : ""}`}><header><span className="assistant-model">{modelName ?? "模型"}</span><time>{runLabel ?? ""}</time></header><div className="message-body"><ChatMarkdown content={item.text} /></div>{item.isError ? <p className="chat-error" role="alert">此任务未能完成。</p> : null}</article>;
}

function ExecutionItems({ items }: { items: RuntimeTimelineItem[] }) {
  return <>{items.map((item, index) => {
    if (item.kind === "tool") return <ToolSteps key={`${item.id}-${index}`} tools={[item]} />;
    if (item.kind === "thinking") return <div className="thinking-content" key={`${item.kind}-${index}`}><ChatMarkdown content={item.text} /></div>;
    if (item.kind === "status") return <p className={`runtime-timeline-status${item.isError ? " failed" : ""}`} key={`${item.kind}-${index}`} role="status">{item.text}</p>;
    if (item.kind === "user") return null;
    return <div className="execution-inline" key={`${item.kind}-${index}`}><ChatMarkdown content={item.text} /></div>;
  })}</>;
}

/** Shared renderer for live run timelines and completed execution transcripts. */
export function RuntimeTimelineContent({ items, isStreaming, modelName, runLabel, error, executionLabel = "思考与执行过程", variant = "streaming", scrollable = false, className, loading = false, emptyText = "代理正在启动，尚未返回过程事件。" }: RuntimeTimelineContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentsRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastTextIndex = items.map((item) => item.kind).lastIndexOf("text");
  const executionItems = lastTextIndex >= 0 ? items.filter((item, index) => item.kind !== "user" && index !== lastTextIndex) : items.filter((item) => item.kind !== "user");
  const finalText = lastTextIndex >= 0 ? items[lastTextIndex] : null;
  const users = items.filter((item): item is Extract<RuntimeTimelineItem, { kind: "user" }> => item.kind === "user");

  useLayoutEffect(() => {
    if (!scrollable) return;
    const container = scrollRef.current;
    const contents = contentsRef.current;
    if (!container || !contents) return;
    const scroll = () => { if (stickToBottomRef.current) container.scrollTop = container.scrollHeight; };
    scroll();
    const observer = new ResizeObserver(scroll);
    observer.observe(contents);
    return () => observer.disconnect();
  }, [items, loading, scrollable]);

  const content = loading ? <p className="subagent-widget-empty">正在连接运行流…</p> : items.length === 0 ? <p className="subagent-widget-empty">{emptyText}</p> : variant === "execution" ? <ExecutionCollapse label={executionLabel}><ExecutionItems items={items} /></ExecutionCollapse> : variant === "completed" ? <>{users.map((item, index) => <UserItem item={item} key={`user-${index}`} />)}<ExecutionCollapse label={executionLabel}>{executionItems.length > 0 ? <ExecutionItems items={executionItems} /> : <p className="execution-unavailable">此模型未返回可展示的思考或工具事件。</p>}</ExecutionCollapse>{finalText?.kind === "text" ? <><div className="final-separator" aria-hidden="true" /><DirectItem item={{ ...finalText, isError: finalText.isError || Boolean(error) }} modelName={modelName} runLabel={runLabel} live /></> : null}</> : <>{items.map((item, index) => <DirectItem item={item} modelName={modelName} runLabel={runLabel} live={item.kind === "text"} key={`${item.kind}-${item.kind === "tool" ? item.id : index}`} />)}{error ? <p className="chat-error" role="alert">{error}</p> : null}</>;

  const rootClassName = ["runtime-timeline-content", isStreaming ? "streaming" : "", className].filter(Boolean).join(" ");
  if (!scrollable) return <div className={rootClassName}>{content}</div>;
  return <div ref={scrollRef} className={className ?? "subagent-widget-event-stream"} onScroll={() => { const node = scrollRef.current; if (node) stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; }} onWheelCapture={(event) => { if (event.deltaY < 0) stickToBottomRef.current = false; }}><div ref={contentsRef} className="subagent-widget-event-content">{content}</div></div>;
}
