"use client";

import { useEffect, useRef, useState } from "react";
import type { SubagentActivity, SubagentDetails, SubagentMessageItem, SubagentRunResult } from "@/contracts";
import { ChatMarkdown } from "@/components/chat-markdown";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

function usageSummary(result: SubagentRunResult): string {
  const parts: string[] = [];
  const { usage } = result;
  if (usage.turns) parts.push(`${usage.turns} 轮`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  return parts.join(" · ");
}

function statusOf(result: SubagentRunResult, running: boolean): "running" | "done" | "failed" {
  // 运行中优先：single 模式下扩展初始 exitCode 为 0（非 -1），不能仅凭 exitCode 判定。
  if (running) return "running";
  if (result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted") return "failed";
  return "done";
}

/** 工具调用名 → 展示名（与主对话的 TOOL_LABELS 一致的中文）。 */
const TOOL_LABELS: Record<string, string> = {
  read: "读取文件",
  ls: "列出目录",
  find: "搜索文件",
  grep: "搜索内容",
  write: "写入文件",
  edit: "编辑文件",
  bash: "执行命令",
  workspace_read: "读取文件",
  workspace_list: "列出目录",
  workspace_find: "搜索文件",
  workspace_grep: "搜索内容",
  workspace_write: "写入文件",
  workspace_edit: "编辑文件",
};

/** 工具调用行摘要：bash 显示命令，read/write 显示路径，其余显示参数 JSON。 */
function toolStepLabel(name: string, args: string): string {
  const label = TOOL_LABELS[name] ?? name;
  if (!args) return label;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    let detail = "";
    if (typeof parsed.path === "string") detail = parsed.path;
    else if (typeof parsed.command === "string") detail = parsed.command;
    else if (typeof parsed.pattern === "string") detail = parsed.pattern;
    else if (typeof parsed.query === "string") detail = parsed.query;
    else detail = args;
    return detail ? `${label} · ${detail.length > 140 ? `${detail.slice(0, 140)}…` : detail}` : label;
  } catch {
    return `${label} · ${args}`;
  }
}

/** 把子代理消息流预处理为渲染条目：assistant 中的 toolCall 与后续 toolResult 按 id 配对。 */
type TranscriptEntry =
  | { kind: "user"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; args: string; result?: string; isError: boolean; running: boolean }
  | { kind: "text"; text: string; isError?: boolean };

function buildTranscript(messages: SubagentMessageItem[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const toolResults = new Map<string, { text: string; isError: boolean }>();
  for (const message of messages) {
    if (message.role === "toolResult" && message.toolCallId) {
      toolResults.set(message.toolCallId, { text: message.text, isError: message.isError });
    }
  }
  for (const message of messages) {
    if (message.role === "user") {
      entries.push({ kind: "user", text: message.text });
      continue;
    }
    if (message.role === "assistant") {
      if (message.thinking) entries.push({ kind: "thinking", text: message.thinking });
      for (const call of message.toolCalls) {
        const result = toolResults.get(call.id);
        entries.push({ kind: "tool", id: call.id, name: call.name, args: call.args, ...(result ? { result: result.text, isError: result.isError } : { isError: false }), running: !result });
      }
      if (message.text) entries.push({ kind: "text", text: message.text, ...(message.errorMessage ? { isError: true } : {}) });
      if (message.errorMessage && !message.text) entries.push({ kind: "text", text: message.errorMessage, isError: true });
      continue;
    }
    // 未配对的 toolResult（无 toolCallId）：单独展示
    entries.push({ kind: "tool", id: `orphan-${entries.length}`, name: message.toolName, args: "", ...(message.toolCallId ? { id: message.toolCallId } : {}), result: message.text, isError: message.isError, running: false });
  }
  return entries;
}

/** 工具调用行（与主对话 codex-tool-step 同款）：点击展开原始返回。 */
function SubagentToolStep({ entry }: { entry: Extract<TranscriptEntry, { kind: "tool" }> }) {
  const [expanded, setExpanded] = useState(false);
  const outputId = `sub-tool-output-${entry.id}`;
  const parts = toolStepLabel(entry.name, entry.args).split("·").map((part) => part.trim());
  return (
    <div className={`codex-tool-step${entry.isError ? " failed" : ""}${entry.running ? " running" : ""}${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="codex-tool-trigger"
        disabled={!entry.result && entry.running}
        aria-expanded={expanded}
        aria-controls={outputId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="codex-tool-bullet" aria-hidden="true">{entry.running ? <i className="codex-spinner" /> : entry.isError ? "✗" : "✓"}</span>
        <span className="codex-tool-name">{parts[0]}</span>
        {parts.length > 1 ? <span className="codex-tool-args">{parts.slice(1).join(" · ")}</span> : null}
        {entry.result ? <span className="codex-tool-disclosure" aria-hidden="true">{expanded ? "⌄" : "›"}</span> : null}
      </button>
      {expanded && entry.result !== undefined ? <pre id={outputId} className="codex-tool-output">{entry.result}</pre> : null}
    </div>
  );
}

/** 子代理消息流渲染：与主对话同款样式（用户气泡 / 思考折叠 / 工具行 / Markdown 回复）。 */
function SubagentTranscript({ messages, running }: { messages: SubagentMessageItem[]; running: boolean }) {
  const entries = buildTranscript(messages);
  if (entries.length === 0) return null;
  return (
    <div className="subagent-transcript">
      {entries.map((entry, index) => {
        if (entry.kind === "user") {
          return (
            <article key={index} className="user-message" aria-label="子代理指令">
              <div className="message-body"><ChatMarkdown content={entry.text} /></div>
            </article>
          );
        }
        if (entry.kind === "thinking") {
          // 子代理思考直接展开（与主对话实时思考的 thinking-content 同款样式），不折叠。
          return (
            <div key={index} className="thinking-content">
              <ChatMarkdown content={entry.text} />
            </div>
          );
        }
        if (entry.kind === "tool") {
          return <SubagentToolStep key={index} entry={entry} />;
        }
        return (
          <article key={index} className={`assistant-reply subagent-reply${entry.isError ? " failed" : ""}`} aria-label="子代理回复">
            <div className="message-body"><ChatMarkdown content={entry.text} /></div>
          </article>
        );
      })}
    </div>
  );
}

/** 单个子代理运行的完整视图：状态头 + 指令 + 对话流 + 统计。 */
function RunResultView({ result, running }: { result: SubagentRunResult; running: boolean }) {
  const status = statusOf(result, running);
  const icon = status === "running" ? <i className="codex-spinner" aria-hidden="true" /> : status === "failed" ? "✗" : "✓";
  const usage = usageSummary(result);
  return (
    <section className={`subagent-run${status === "failed" ? " failed" : ""}${status === "running" ? " running" : ""}`}>
      <header className="subagent-run-header">
        <span className="subagent-run-icon" aria-hidden="true">{icon}</span>
        <strong>{result.agent}</strong>
        <span className="subagent-run-source">({result.agentSource})</span>
        {typeof result.step === "number" ? <span className="subagent-run-step">步骤 {result.step}</span> : null}
        {result.model ? <span className="subagent-run-model">{result.model}</span> : null}
        {status === "running" ? <span className="subagent-run-status">运行中…</span> : null}
        {status === "failed" && result.stopReason ? <span className="subagent-run-status failed">{result.stopReason}</span> : null}
      </header>
      {result.task ? (
        <div className="subagent-task">
          <span className="subagent-msg-role">指令</span>
          <div className="subagent-task-body"><ChatMarkdown content={result.task} /></div>
        </div>
      ) : null}
      {result.messages.length > 0 ? (
        <SubagentTranscript messages={result.messages} running={running} />
      ) : (
        <p className="subagent-empty">{(status === "running" || result.exitCode === -1) ? "正在启动…" : "（无输出）"}</p>
      )}
      {result.errorMessage ? <div className="subagent-error">错误：{result.errorMessage}</div> : null}
      {result.stderr ? <div className="subagent-error">stderr：{result.stderr}</div> : null}
      {usage ? <footer className="subagent-run-usage">{usage}</footer> : null}
    </section>
  );
}

function modeLabel(details: SubagentDetails): string {
  if (details.mode === "chain") return "链式";
  if (details.mode === "parallel") return "并行";
  return "单个";
}

/** 判断活动是否仍在运行（实时 running 标志或 details 中仍有 exitCode === -1 的任务）。 */
export function isSubagentRunning(activity: SubagentActivity): boolean {
  return activity.running || activity.details.results.some((result) => result.exitCode === -1);
}

/** 侧边栏子代理面板中的一次运行活动（折叠行 + 展开后的完整对话）。 */
export function SubagentActivityItem({ activity }: { activity: SubagentActivity }) {
  // 运行中的条目自动展开（方便实时查看进度）；完成后自动折叠。用户手动切换后不再自动变化。
  const [expanded, setExpanded] = useState(() => activity.running);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (!userToggledRef.current) setExpanded(activity.running);
  }, [activity.running]);
  const { details } = activity;
  const first = details.results[0];
  const total = details.results.length;
  const done = details.results.filter((result) => result.exitCode !== -1).length;
  const running = isSubagentRunning(activity);
  const anyFailed = details.results.some((result) => result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted");

  const title = first
    ? details.mode === "single"
      ? `${first.agent}${running ? " · 当前运行" : anyFailed ? " · 失败" : " · 运行完成"}`
      : `${modeLabel(details)} ${done}/${total}${running ? " · 当前运行" : ""}`
    : "subagent";

  return (
    <article className={`subagent-activity${running ? " running" : ""}${anyFailed ? " failed" : ""}`}>
      <button type="button" className="subagent-activity-trigger" onClick={() => { userToggledRef.current = true; setExpanded((current) => !current); }} aria-expanded={expanded}>
        <span className="codex-tool-bullet" aria-hidden="true">{running ? <i className="codex-spinner" /> : anyFailed ? "✗" : "✓"}</span>
        <span className="subagent-activity-title">{title}</span>
        <span className="codex-tool-disclosure" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded ? (
        <div className="subagent-activity-body">
          {details.results.map((result, index) => <RunResultView key={index} result={result} running={running && result.exitCode === -1} />)}
          {activity.result && details.results.length === 0 ? <pre className="codex-tool-output">{activity.result}</pre> : null}
        </div>
      ) : null}
    </article>
  );
}

/** 子代理面板：可用 agents 列表（可展开查看 system prompt）。 */
export function AgentDescriptorItem({ agent }: { agent: { name: string; description: string; source: string; model?: string; tools?: string[]; systemPrompt: string } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="agent-descriptor">
      <button type="button" className="agent-descriptor-trigger" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <strong>{agent.name}</strong>
        <span className="agent-descriptor-source">{agent.source === "project" ? "项目" : "用户"}</span>
        {agent.model ? <code className="agent-descriptor-model">{agent.model}</code> : null}
        <span className="codex-tool-disclosure" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded ? (
        <div className="agent-descriptor-body">
          <p className="agent-descriptor-desc">{agent.description}</p>
          {agent.tools && agent.tools.length > 0 ? <p className="agent-descriptor-tools">工具：{agent.tools.join(", ")}</p> : null}
          <details className="agent-descriptor-prompt">
            <summary>System Prompt</summary>
            <pre>{agent.systemPrompt}</pre>
          </details>
        </div>
      ) : null}
    </article>
  );
}
