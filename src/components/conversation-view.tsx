"use client";

import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { RuntimeTimelineContent, type RuntimeTimelineItem } from "@/components/runtime-timeline";
import type { ChatTimelineItem, PendingQueueItem } from "@/client/use-chat-stream";
import type { ConversationItem, ModelDescriptor } from "@/contracts";

type ConversationViewProps = {
  conversation: ConversationItem[];
  pendingPrompt: string;
  timeline: ChatTimelineItem[];
  pendingQueue: PendingQueueItem[];
  retry: { attempt: number; maxAttempts: number; delayMs: number; message: string } | null;
  error: string;
  isStreaming: boolean;
  runId: string;
  isLoading: boolean;
  truncated: boolean;
  onLoadEarlier?: () => Promise<boolean>;
  loadingEarlier?: boolean;
  models: ModelDescriptor[];
  liveModelName: string;
  onUserMessageAction?: (action: "copy" | "edit" | "fork", content: string, entryId?: string) => void;
  runStartedAt?: number;
  runFinishedAt?: number | null;
  runReplay?: boolean;
};

/** 一个任务组：从用户消息开始，保留思考、工具与回复的原始顺序。 */
type TaskGroup = {
  user?: Extract<ConversationItem, { type: "user" }>;
  items: ConversationItem[];
};

function timeLabel(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/** 将毫秒格式化为可读的耗时。 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** 任务组执行时间：从用户发出任务到最终回复的实际跨度。 */
function taskDuration(items: ConversationItem[]): string | null {
  const first = items.find((item) => item.type === "user") ?? items.find((item) => item.type !== "user");
  let last: ConversationItem | undefined;
  for (const item of items) if (item.type === "assistant") last = item;
  if (!first || !last) return null;
  const start = Date.parse(first.timestamp);
  const end = Date.parse(last.timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return formatDuration(end - start);
}

function taskGroups(conversation: ConversationItem[]) {
  const groups: TaskGroup[] = [];
  let current: TaskGroup | undefined;
  for (const item of conversation) {
    if (item.type === "user") {
      current = { user: item, items: [item] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

function modelLabel(model: { provider: string; id: string } | undefined, models: ModelDescriptor[]) {
  if (!model) return "模型";
  return models.find((candidate) => candidate.provider === model.provider && candidate.id === model.id)?.name ?? model.id;
}

function imagesBeforeText(content: string) {
  const imageLines: string[] = [];
  const textLines: string[] = [];
  for (const line of content.split("\n")) {
    if (/^!\[[^\]]*\]\([^\s)]+(?:\s+[^)]*)?\)$/.test(line.trim())) imageLines.push(line);
    else textLines.push(line);
  }
  const images = imageLines.join("\n\n");
  const text = textLines.join("\n").trim();
  return images && text ? `${images}\n\n${text}` : images || text;
}


function UserMessage({ content, timestamp, pending, entryId, onAction }: { content: string; timestamp?: string; pending?: boolean; entryId?: string; onAction?: (action: "copy" | "edit" | "fork", content: string, entryId?: string) => void }) {
  return (
    <article className={`user-message${pending ? " pending" : ""}`} aria-label="你的任务">
      <div className="message-body"><ChatMarkdown content={imagesBeforeText(content)} /></div>
      {timestamp || (!pending && onAction) ? (
        <div className="user-message-meta">
          {timestamp ? <time dateTime={timestamp}>{timeLabel(timestamp)}</time> : null}
          {!pending && onAction ? (
            <div className="user-message-actions">
              <button type="button" onClick={() => onAction("copy", content, entryId)} aria-label="复制这条消息"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>复制</button>
              {entryId ? <button type="button" onClick={() => onAction("edit", content, entryId)} aria-label="从此处编辑"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>从此处编辑</button> : null}
              {entryId ? <button type="button" onClick={() => onAction("fork", content, entryId)} aria-label="从此处分支"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>从此处分支</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** 渲染单个历史任务组：用户消息 → 折叠的执行过程 → 最终回复。 */
function HistoricalTask({ task, models, onUserMessageAction }: { task: TaskGroup; models: ModelDescriptor[]; onUserMessageAction?: (action: "copy" | "edit" | "fork", content: string, entryId?: string) => void }) {
  const items = task.items;
  const duration = taskDuration(items);
  const finalIndex = items.map((item) => item.type).lastIndexOf("assistant");
  const user = items.find((item) => item.type === "user");
  const finalItem = finalIndex >= 0 ? (items[finalIndex] as Extract<ConversationItem, { type: "assistant" }>) : undefined;
  const executionItems: RuntimeTimelineItem[] = items.filter((item, index) => item.type === "thinking" || item.type === "tool" || (item.type === "assistant" && index !== finalIndex)).map((item) => {
    if (item.type === "tool") return { kind: "tool", id: item.id, name: item.name, label: item.label, result: item.result, isError: item.isError, running: false };
    if (item.type === "thinking") return { kind: "thinking", text: item.content };
    if (item.type === "assistant") return { kind: "text", text: item.content, isError: item.isError };
    return { kind: "status", text: "状态已更新" };
  });
  return (
    <section className="task-group">
      {user ? <UserMessage content={user.content} timestamp={user.timestamp} entryId={user.id} onAction={onUserMessageAction} /> : null}
      {executionItems.length > 0 ? <RuntimeTimelineContent items={executionItems} isStreaming={false} variant="execution" executionLabel={`思考与执行过程${duration ? ` · ${duration}` : ""}`} /> : null}
      {finalItem ? <>
        <div className="final-separator" aria-hidden="true" />
        <RuntimeTimelineContent items={[{ kind: "text", text: finalItem.content, isError: finalItem.isError }]} isStreaming={false} modelName={modelLabel(finalItem.model, models)} runLabel={timeLabel(finalItem.timestamp)} />
      </> : null}
    </section>
  );
}

const STREAM_BOTTOM_INSET = 220;
const STREAM_TOP_INSET = 32;

export const ConversationView = memo(function ConversationView({ conversation, pendingPrompt, timeline, pendingQueue, retry, error, isStreaming, runId, isLoading, truncated, onLoadEarlier, loadingEarlier = false, models, liveModelName, onUserMessageAction, runStartedAt, runFinishedAt, runReplay = false }: ConversationViewProps) {
  const hasLiveResponse = Boolean(pendingPrompt || timeline.length > 0 || pendingQueue.length > 0 || error || isStreaming);
  const tasks = useMemo(() => taskGroups(conversation), [conversation]);
  const conversationKey = `${conversation.length}:${conversation.at(-1)?.timestamp ?? ""}`;
  const conversationRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const liveTaskRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const shouldScrollAfterLoadingRef = useRef(false);
  const browsingHistoryRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const streamStartedRef = useRef(false);
  const loadEarlierRequestedRef = useRef(false);
  const earlierScrollSnapshotRef = useRef<{ height: number; top: number; itemCount: number } | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const scrollToBottomIfNeeded = useCallback(() => {
    const container = conversationRef.current;
    if (!container) return false;
    const target = Math.max(0, container.scrollHeight - container.clientHeight);
    if (Math.abs(container.scrollTop - target) < 1) return false;
    container.scrollTop = target;
    lastScrollTopRef.current = container.scrollTop;
    return true;
  }, []);

  const requestEarlierConversation = () => {
    const container = conversationRef.current;
    if (!container || !truncated || loadingEarlier || loadEarlierRequestedRef.current || !onLoadEarlier) return;
    loadEarlierRequestedRef.current = true;
    earlierScrollSnapshotRef.current = { height: container.scrollHeight, top: container.scrollTop, itemCount: conversation.length };
    void onLoadEarlier().then((loaded) => {
      if (!loaded) earlierScrollSnapshotRef.current = null;
    }).finally(() => {
      loadEarlierRequestedRef.current = false;
    });
  };

  const updateBottomStickiness = () => {
    const container = conversationRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    if (container.scrollTop < lastScrollTopRef.current) browsingHistoryRef.current = true;
    lastScrollTopRef.current = container.scrollTop;
    shouldStickToBottomRef.current = atBottom;
    if (atBottom) browsingHistoryRef.current = false;
  };

  const pauseBottomStickiness = () => {
    browsingHistoryRef.current = true;
    shouldStickToBottomRef.current = false;
  };

  useLayoutEffect(() => {
    if (isStreaming && !streamStartedRef.current) {
      streamStartedRef.current = true;
      browsingHistoryRef.current = false;
      shouldStickToBottomRef.current = true;
    }
    if (!isStreaming) streamStartedRef.current = false;
  }, [isStreaming, pendingPrompt, runId]);

  // 流式增量/状态切换时保持底部；用户浏览历史后，本轮不再抢回滚动位置。
  useLayoutEffect(() => {
    if (isLoading) {
      shouldScrollAfterLoadingRef.current = true;
      return;
    }
    const container = conversationRef.current;
    const earlierSnapshot = earlierScrollSnapshotRef.current;
    if (container && earlierSnapshot && conversation.length > earlierSnapshot.itemCount) {
      container.scrollTop = earlierSnapshot.top + container.scrollHeight - earlierSnapshot.height;
      lastScrollTopRef.current = container.scrollTop;
      earlierScrollSnapshotRef.current = null;
      return;
    }
    if (!container || browsingHistoryRef.current) return;
    if (shouldScrollAfterLoadingRef.current || shouldStickToBottomRef.current) {
      scrollToBottomIfNeeded();
      shouldStickToBottomRef.current = true;
      shouldScrollAfterLoadingRef.current = false;
    }
  }, [conversation, conversationKey, error, isLoading, isStreaming, pendingPrompt, pendingQueue, scrollToBottomIfNeeded, timeline]);

  // 按当前任务实际高度计算底部留白，使任务起点尽量贴近聊天区顶部。
  useLayoutEffect(() => {
    const container = conversationRef.current;
    const liveTask = liveTaskRef.current;
    if (!container || !liveTask || !isStreaming) {
      container?.style.removeProperty("--live-task-space");
      return;
    }
    const updateLiveTaskSpace = () => {
      const space = Math.max(0, container.clientHeight - STREAM_BOTTOM_INSET - STREAM_TOP_INSET - liveTask.offsetHeight);
      const value = `${Math.ceil(space)}px`;
      if (container.style.getPropertyValue("--live-task-space") !== value) container.style.setProperty("--live-task-space", value);
      if (shouldStickToBottomRef.current && !browsingHistoryRef.current) scrollToBottomIfNeeded();
    };
    const observer = new ResizeObserver(updateLiveTaskSpace);
    observer.observe(container);
    observer.observe(liveTask);
    updateLiveTaskSpace();
    return () => observer.disconnect();
  }, [isStreaming, scrollToBottomIfNeeded]);

  // 内容高度变化（工具展开、图片加载、markdown 延迟渲染等）时同样保持底部。
  useLayoutEffect(() => {
    const container = conversationRef.current;
    const rail = railRef.current;
    if (!container || !rail) return;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current && !browsingHistoryRef.current && !isLoading) scrollToBottomIfNeeded();
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, [isLoading, scrollToBottomIfNeeded]);

  // 重放（刷新后恢复）的 run 不计耗时：其 startedAt/finishedAt 是重放耗时而非真实执行时间。
  const runDuration = !runReplay && runStartedAt && runFinishedAt ? formatDuration(runFinishedAt - runStartedAt) : null;
  const isFinished = !isStreaming;

  return (
    <div
      ref={conversationRef}
      className={`conversation${isStreaming ? " streaming" : ""}`}
      onScroll={() => {
        updateBottomStickiness();
        if (conversationRef.current && conversationRef.current.scrollTop <= 2) requestEarlierConversation();
      }}
      onWheelCapture={(event) => {
        if (event.deltaY < 0) pauseBottomStickiness();
      }}
      onTouchStart={(event) => {
        touchStartYRef.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchMove={(event) => {
        const startY = touchStartYRef.current;
        const currentY = event.touches[0]?.clientY;
        if (startY !== null && currentY !== undefined && currentY > startY) pauseBottomStickiness();
      }}
      onTouchEnd={() => {
        touchStartYRef.current = null;
      }}
      aria-live="polite"
      aria-busy={isLoading || isStreaming}
    >
      <div ref={railRef} className="conversation-rail">
        {isLoading ? <p className="conversation-status">正在恢复会话记录…</p> : null}
        {!isLoading && tasks.length === 0 && !hasLiveResponse ? (
          <div className="empty-chat">
            <div className="empty-chat-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg></div>
            <h2>开始新的对话</h2>
            <p>描述你想要的，或与模型一起创造</p>
          </div>
        ) : null}
        {tasks.map((task, index) => <HistoricalTask task={task} models={models} onUserMessageAction={onUserMessageAction} key={`${task.user?.timestamp ?? "history"}-${index}`} />)}

        {isStreaming ? (
          <div ref={liveTaskRef} className="live-task">
            {pendingPrompt ? <UserMessage content={pendingPrompt} pending /> : null}
            {!error ? (
              <>
                {retry ? <div className="retry-status" role="status">上游服务繁忙，{Math.max(1, Math.ceil(retry.delayMs / 1000))} 秒后进行第 {retry.attempt}/{retry.maxAttempts} 次重试。</div> : null}
                {timeline.length === 0 && !retry ? <div className="thinking-content">正在思考…</div> : null}
                <RuntimeTimelineContent items={timeline.map((item): RuntimeTimelineItem => item.kind === "tool" ? { kind: "tool", id: item.id, name: item.name, label: item.label, result: item.result, isError: item.isError, running: item.running } : item.kind === "thinking" ? { kind: "thinking", text: item.text } : item.kind === "user" ? { kind: "user", content: item.content, timestamp: item.timestamp } : { kind: "text", text: item.text })} isStreaming modelName={liveModelName} runLabel={runId ? runId.slice(0, 8) : "进行中"} />
              </>
            ) : null}
            {pendingQueue.length > 0 ? (
              <section className="pending-queue" aria-label="待处理消息" role="status">
                <header><span>待处理消息</span><span>{pendingQueue.length}</span></header>
                <ol>
                  {pendingQueue.map((item, index) => <li key={item.id}><span className="pending-queue-order">{index + 1}</span><div><span className="pending-queue-state">等待处理</span><ChatMarkdown content={imagesBeforeText(item.content)} /></div></li>)}
                </ol>
              </section>
            ) : null}
          </div>
        ) : pendingPrompt ? <UserMessage content={pendingPrompt} pending /> : null}

        {/* 完成：思考+执行过程折叠，最终回复保留在外 */}
        {isFinished && timeline.length > 0 ? (
          <>
            <RuntimeTimelineContent items={timeline.map((item): RuntimeTimelineItem => item.kind === "tool" ? { kind: "tool", id: item.id, name: item.name, label: item.label, result: item.result, isError: item.isError, running: item.running } : item.kind === "thinking" ? { kind: "thinking", text: item.text } : item.kind === "user" ? { kind: "user", content: item.content, timestamp: item.timestamp } : { kind: "text", text: item.text })} isStreaming={false} variant="completed" modelName={liveModelName} runLabel={runId ? runId.slice(0, 8) : "进行中"} error={error} executionLabel={`思考与执行过程${runDuration ? ` · ${runDuration}` : ""}`} />
          </>
        ) : null}
        {error ? <p className="chat-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
});
