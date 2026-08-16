"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RuntimeTimelineContent, type RuntimeTimelineItem } from "@/components/runtime-timeline";
import { type TaskEvent, type TaskSnapshot, useRunningSubagents } from "@/client/use-running-subagents";

type SubagentWidgetProps = { sessionId: string | null | undefined };


function timeValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(task: TaskSnapshot, now: number): string {
  const start = timeValue(task.startTime);
  if (!start) return "刚刚开始";
  const end = timeValue(task.finishTime) ?? now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const ACTIVE_TASK_STATUSES = ["pending", "queued", "running"] as const;

function isTaskTerminal(status: string): boolean {
  return !ACTIVE_TASK_STATUSES.includes(status as typeof ACTIVE_TASK_STATUSES[number]);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: "等待中", queued: "排队中", running: "运行中", done: "已完成", failed: "失败", killed: "已终止", timeout: "已超时" };
  return labels[status] ?? status;
}

function ModeBadge({ mode }: { mode: TaskSnapshot["sessionMode"] }) {
  return <span className={`subagent-widget-mode ${mode === "persistent" ? "persistent" : "ephemeral"}`}>{mode === "persistent" ? "常驻" : "临时"}</span>;
}

function mergeText(previous: string | undefined, value: string, isDelta: boolean) {
  if (!previous || isDelta) return (previous ?? "") + value;
  if (value.startsWith(previous)) return value;
  if (previous.startsWith(value)) return previous;
  return previous + value;
}

export function taskEventsToRuntimeTimeline(events: TaskEvent[], taskStatus: string): RuntimeTimelineItem[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const items: RuntimeTimelineItem[] = [];
  for (const event of ordered) {
    if (event.kind === "thinking") {
      const isDelta = event.data.delta !== undefined && event.data.content === undefined;
      const text = event.data.content ?? event.data.delta ?? "正在思考…";
      const previous = items.at(-1);
      if (previous?.kind === "thinking") items[items.length - 1] = { ...previous, text: mergeText(previous.text, text, isDelta) };
      else items.push({ kind: "thinking", text });
    } else if (event.kind === "text") {
      const isDelta = event.data.delta !== undefined && event.data.content === undefined;
      const text = event.data.content ?? event.data.delta ?? "";
      const previous = items.at(-1);
      if (previous?.kind === "text") items[items.length - 1] = { ...previous, text: mergeText(previous.text, text, isDelta), isError: event.data.isError ?? previous.isError };
      else items.push({ kind: "text", text, isError: event.data.isError });
    } else if (event.kind === "tool") {
      const name = event.data.name ?? "工具";
      const label = event.data.label ?? name;
      const existingIndex = event.data.id ? items.findIndex((item) => item.kind === "tool" && item.id === event.data.id) : items.findIndex((item) => item.kind === "tool" && item.running && item.name === name && item.label === label);
      const running = event.data.running ?? (event.data.result === undefined && !event.data.isError);
      const tool: RuntimeTimelineItem = { kind: "tool", id: event.data.id ?? `task-tool-${event.seq}`, name, label, result: event.data.result, isError: Boolean(event.data.isError), running };
      if (existingIndex >= 0) items[existingIndex] = { ...items[existingIndex], ...tool, id: items[existingIndex].kind === "tool" ? items[existingIndex].id : tool.id };
      else items.push(tool);
    } else {
      items.push({ kind: "status", text: event.data.status ?? event.data.content ?? "状态已更新", isError: event.data.isError });
    }
  }
  if (isTaskTerminal(taskStatus)) {
    return items.map((item) => item.kind === "tool" ? { ...item, running: false } : item);
  }
  return items;
}
function RunModal({ task, events, loading, now, onClose }: { task: TaskSnapshot; events: TaskEvent[]; loading: boolean; now: number; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="subagent-widget-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="subagent-widget-modal" role="dialog" aria-modal="true" aria-labelledby="subagent-widget-modal-title">
        <header>
          <div className="subagent-widget-modal-title"><p>{task.nickname || "子代理运行"}</p><h2 id="subagent-widget-modal-title">{task.agentName}</h2></div>
          <div className="subagent-widget-modal-meta"><ModeBadge mode={task.sessionMode} /><span className={`subagent-widget-status-pill ${task.status}`}>{statusLabel(task.status)}</span><time>{formatDuration(task, now)}</time><button type="button" onClick={onClose} aria-label="关闭子代理运行详情" title="关闭">x</button></div>
        </header>
        <RuntimeTimelineContent items={taskEventsToRuntimeTimeline(events, task.status)} isStreaming={!isTaskTerminal(task.status)} modelName={task.agentName} runLabel={statusLabel(task.status)} scrollable loading={loading} />
        {task.errorMessage ? <footer className="subagent-widget-error" role="alert">{task.errorMessage}</footer> : null}
      </section>
    </div>
  );
}

/** Fixed entry point for active subagent runs in the current conversation. */
export function SubagentWidget({ sessionId }: SubagentWidgetProps) {
  const { runningTasks, allTasks, getTaskEvents, isLoading } = useRunningSubagents(sessionId);
  const [open, setOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const leaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const updateTimer = window.setTimeout(() => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
      if (runningTasks.length > 0) {
        setVisible(true);
        setLeaving(false);
        return;
      }
      setOpen(false);
      setLeaving(true);
      leaveTimerRef.current = window.setTimeout(() => { setVisible(false); setLeaving(false); }, 2_000);
    }, 0);
    return () => window.clearTimeout(updateTimer);
  }, [runningTasks.length]);

  useEffect(() => {
    if (runningTasks.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runningTasks.length]);

  useEffect(() => () => { if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current); }, []);

  const selectedTask = allTasks.find((task) => task.taskId === selectedTaskId) ?? null;
  if (!visible && !selectedTask) return null;
  const countLabel = runningTasks.length > 9 ? "9+" : String(runningTasks.length);
  return (
    <div className="subagent-widget">
      {visible ? <>
        <button type="button" className={`subagent-widget-entry${leaving ? " leaving" : ""}`} onClick={() => setOpen((current) => !current)} aria-label={`查看 ${runningTasks.length} 个运行中的子代理`} aria-expanded={open} aria-controls="subagent-widget-list" title="查看子代理运行">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
          <span className="subagent-widget-count" aria-hidden="true">{countLabel}</span><span className="subagent-widget-pulse" aria-hidden="true" />
        </button>
        {open ? <section id="subagent-widget-list" className="subagent-widget-popover" aria-label="运行中的子代理">{runningTasks.length > 0 ? <ul>{runningTasks.map((task) => <li key={task.taskId}><button type="button" onClick={() => { setSelectedTaskId(task.taskId); setOpen(false); }}><span className="subagent-widget-item-main"><strong>{task.agentName}</strong>{task.nickname && task.nickname !== task.agentName ? <small>{task.nickname}</small> : null}</span><span className="subagent-widget-item-meta"><ModeBadge mode={task.sessionMode} /><span className={`subagent-widget-status-pill ${task.status}`}>{statusLabel(task.status)}</span><time>{formatDuration(task, now)}</time></span>{task.task ? <span className="subagent-widget-tooltip">{task.task}</span> : null}</button></li>)}</ul> : <p className="subagent-widget-list-empty">暂无运行中的子代理</p>}</section> : null}
      </> : null}
      {selectedTask && typeof document !== "undefined" ? createPortal(<RunModal task={selectedTask} events={getTaskEvents(selectedTask.taskId)} loading={isLoading} now={now} onClose={() => setSelectedTaskId(null)} />, document.body) : null}
    </div>
  );
}
