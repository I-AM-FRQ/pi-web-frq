"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorResponse, ChatRequest, ChatStreamEvent, LiveTimelineItem, LiveToolStep } from "@/contracts";

export type ChatRun = {
  id: string;
  sessionId: string | null;
  pendingPrompt: string;
  tools: LiveToolStep[];
  timeline: LiveTimelineItem[];
  text: string;
  thinking: string;
  retry: { attempt: number; maxAttempts: number; delayMs: number; message: string } | null;
  runId: string;
  error: string;
  queued: { steering: string[]; followUp: string[] };
  stopping: boolean;
  tokenSpeed: number;
  isStreaming: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** 是否为刷新后恢复（重放）旧运行：其 startedAt/finishedAt 是重放耗时，不是真实执行时间。 */
  replay?: boolean;
};

type StreamCallbacks = {
  onSessionId?: (sessionId: string) => void;
  onCompleted?: (sessionId: string, runId: string) => void;
};

function readErrorMessage(payload: unknown) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || "请求失败，请稍后重试。";
}

let runSequence = 0;

/** 估算字符到 token 的折算系数：中文 1 字≈1 token，英文约 4 字符 1 token，混合取 2.5。 */
const CHARS_PER_TOKEN = 2.5;
const SPEED_WINDOW_MS = 3_000;

/** 重连退避延迟：1s/2s/4s/8s/16s 封顶（attempt 为重试序号，从 0 开始）。 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempt, 4), 16_000);
}

function nextRunId() {
  runSequence += 1;
  return `run-${Date.now()}-${runSequence}`;
}

/** 追加增量到时间线末尾的同类文本块，保持事件顺序。 */
function appendTimelineDelta(timeline: LiveTimelineItem[], kind: "text" | "thinking", delta: string): LiveTimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (last && last.kind === kind) {
    return [...timeline.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...timeline, { kind, text: delta }];
}

export function readChatStreamEvents(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (!data || data === "[DONE]") return;

    try {
      onEvent(JSON.parse(data) as ChatStreamEvent);
    } catch {
      throw new Error("服务返回了无法解析的流事件。");
    }
  };

  const consumeLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "data") dataLines.push(value);
  };

  const drain = (finished = false) => {
    let cursor = 0;
    while (cursor < buffer.length) {
      const match = /[\r\n]/.exec(buffer.slice(cursor));
      if (!match || match.index === undefined) break;

      const lineEnd = cursor + match.index;
      const terminator = buffer[lineEnd];
      if (terminator === "\r" && lineEnd === buffer.length - 1 && !finished) break;

      consumeLine(buffer.slice(cursor, lineEnd));
      cursor = lineEnd + 1;
      if (terminator === "\r" && buffer[cursor] === "\n") cursor += 1;
    }

    buffer = buffer.slice(cursor);
    if (finished && buffer) {
      consumeLine(buffer);
      buffer = "";
    }
    if (finished) dispatch();
  };

  return (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        drain();
      }
      buffer += decoder.decode();
      drain(true);
    } finally {
      reader.releaseLock();
    }
  })();
}

export function useChatStream() {
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const runSessionIdsRef = useRef<Map<string, string>>(new Map());
  const activeSessionIdsRef = useRef<Set<string>>(new Set());
  const resumeAttemptedSessionIdsRef = useRef<Set<string>>(new Set());
  // ---- 自动重连状态（移动端切后台导致 SSE 断开后自动恢复） ----
  const reconnectingRunsRef = useRef<Set<string>>(new Set());
  const reconnectTimersRef = useRef<Map<string, number>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const reconnectSessionIdsRef = useRef<Map<string, string>>(new Map());
  const reconnectFnsRef = useRef<Map<string, () => void>>(new Map());
  const callbacksBySessionRef = useRef<Map<string, StreamCallbacks>>(new Map());
  const speedSamplesRef = useRef<Map<string, Array<{ chars: number; time: number }>>>(new Map());
  const [runs, setRuns] = useState<ChatRun[]>([]);

  const updateRun = useCallback((id: string, patch: Partial<ChatRun>) => {
    setRuns((current) => current.map((run) => (run.id === id ? { ...run, ...patch } : run)));
  }, []);

  const recordSpeedSample = useCallback((id: string, chars: number) => {
    const now = Date.now();
    const samples = speedSamplesRef.current.get(id) ?? [];
    samples.push({ chars, time: now });
    const recent = samples.filter((sample) => now - sample.time <= SPEED_WINDOW_MS);
    speedSamplesRef.current.set(id, recent);
    const totalChars = recent.reduce((total, sample) => total + sample.chars, 0);
    const startTime = recent.length > 0 ? Math.min(...recent.map((sample) => sample.time)) : now;
    const span = (now - startTime) / 1000;
    updateRun(id, { tokenSpeed: span > 0.3 ? Math.round(totalChars / CHARS_PER_TOKEN / span) : 0 });
  }, [updateRun]);

  const applyStreamEvent = useCallback((id: string, event: ChatStreamEvent, callbacks: StreamCallbacks) => {
    if (event.type === "start") {
      runSessionIdsRef.current.set(id, event.sessionId);
      activeSessionIdsRef.current.add(event.sessionId);
      setRuns((current) => current.map((run) => run.id === id ? { ...run, runId: event.runId, sessionId: event.sessionId, pendingPrompt: event.prompt ?? run.pendingPrompt } : run));
      callbacks.onSessionId?.(event.sessionId);
    }
    if (event.type === "tool_start") {
      setRuns((current) => current.map((run) => (run.id === id ? {
        ...run,
        tools: [...run.tools.filter((tool) => tool.id !== event.id), { id: event.id, name: event.name, label: event.label, isError: false, running: true }],
        timeline: [...run.timeline.filter((item) => !(item.kind === "tool" && item.id === event.id)), { kind: "tool", id: event.id, name: event.name, label: event.label, isError: false, running: true }],
      } : run)));
    }
    if (event.type === "tool_update") {
      // subagent 等工具的实时进度：合并 details 到对应工具条目。
      setRuns((current) => current.map((run) => (run.id === id ? {
        ...run,
        tools: run.tools.map((tool) => (tool.id === event.id ? { ...tool, details: event.details } : tool)),
        timeline: run.timeline.map((item) => (item.kind === "tool" && item.id === event.id ? { ...item, details: event.details } : item)),
      } : run)));
    }
    if (event.type === "tool_end") {
      setRuns((current) => current.map((run) => (run.id === id ? {
        ...run,
        tools: run.tools.map((tool) => (tool.id === event.id ? { ...tool, result: event.result, isError: event.isError, running: false, ...(event.details ? { details: event.details } : {}) } : tool)),
        timeline: run.timeline.map((item) => (item.kind === "tool" && item.id === event.id ? { ...item, result: event.result, isError: event.isError, running: false, ...(event.details ? { details: event.details } : {}) } : item)),
      } : run)));
    }
    if (event.type === "text_delta") {
      recordSpeedSample(id, event.delta.length);
      setRuns((current) => current.map((run) => (run.id === id ? { ...run, text: run.text + event.delta, timeline: appendTimelineDelta(run.timeline, "text", event.delta) } : run)));
    }
    if (event.type === "thinking_delta") {
      recordSpeedSample(id, event.delta.length);
      setRuns((current) => current.map((run) => (run.id === id ? { ...run, thinking: run.thinking + event.delta, timeline: appendTimelineDelta(run.timeline, "thinking", event.delta) } : run)));
    }
    if (event.type === "retry_scheduled") {
      updateRun(id, { retry: { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.message } });
    }
    if (event.type === "retry_finished") {
      updateRun(id, { retry: null });
    }
    if (event.type === "queue_update") {
      updateRun(id, { queued: { steering: [...event.steering], followUp: [...event.followUp] } });
    }
    if (event.type === "error") {
      finishReconnect(id);
      setRuns((current) => current.map((run) => run.id === id ? { ...run, error: run.stopping ? "已停止。" : event.message, isStreaming: false, tools: [], finishedAt: Date.now() } : run));
    }
    if (event.type === "done") {
      finishReconnect(id);
      updateRun(id, { sessionId: event.sessionId, tools: [], finishedAt: Date.now() });
      callbacks.onSessionId?.(event.sessionId);
      callbacks.onCompleted?.(event.sessionId, id);
      speedSamplesRef.current.delete(id);
      window.setTimeout(() => setRuns((current) => current.filter((run) => run.id !== id)), 1200);
    }
  }, [recordSpeedSample, updateRun]);

  const send = useCallback((request: ChatRequest, callbacks: StreamCallbacks = {}, pendingPrompt = "") => {
    if (request.sessionId && activeSessionIdsRef.current.has(request.sessionId)) return false;
    if (request.sessionId) {
      activeSessionIdsRef.current.add(request.sessionId);
      resumeAttemptedSessionIdsRef.current.delete(request.sessionId);
    }
    const id = nextRunId();
    const controller = new AbortController();
    controllersRef.current.set(id, controller);

    setRuns((current) => {
      // 同一会话的新一次运行会替换旧记录，避免列表无限累积。
      const withoutSameSession = request.sessionId
        ? current.filter((run) => run.sessionId !== request.sessionId)
        : current;
      return [...withoutSameSession, { id, sessionId: request.sessionId ?? null, pendingPrompt, tools: [], timeline: [], text: "", thinking: "", retry: null, runId: "", error: "", queued: { steering: [], followUp: [] }, stopping: false, tokenSpeed: 0, isStreaming: true, startedAt: Date.now(), finishedAt: null, replay: false }];
    });

    void (async () => {
      let receivedError = false;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = "请求失败，请稍后重试。";
          try {
            message = readErrorMessage(await response.json());
          } catch {
            message = `请求失败（HTTP ${response.status}）。`;
          }
          // 4xx（参数/权限类错误）不会因重试而成功；5xx/网络中断才进入自动重连
          if (response.status < 500 && response.status !== 408 && response.status !== 429) receivedError = true;
          throw new Error(message);
        }
        if (!response.body) throw new Error("服务未返回可读取的数据流。");

        let terminalReceived = false;
        await readChatStreamEvents(response.body, (event) => {
          if (event.type === "error") receivedError = true;
          if (event.type === "done" || event.type === "error") terminalReceived = true;
          applyStreamEvent(id, event, callbacks);
        });
        if (!terminalReceived && !controller.signal.aborted) throw new Error("连接在收到完成状态前中断。请重试。");
      } catch (caught) {
        if (!controller.signal.aborted && !receivedError) {
          // 流意外中断（手机切后台/断网）：会话已绑定则自动重连恢复，不判死
          const sessionId = runSessionIdsRef.current.get(id) ?? request.sessionId ?? null;
          if (sessionId) {
            reconnectingRunsRef.current.add(id);
            callbacksBySessionRef.current.set(sessionId, callbacks);
            scheduleReconnect(id, sessionId, callbacks);
          } else {
            controller.abort();
            receivedError = true;
            updateRun(id, { error: caught instanceof Error ? caught.message : "请求失败，请稍后重试。" });
          }
        } else if (!controller.signal.aborted) {
          controller.abort();
          receivedError = true;
        }
      } finally {
        if (!controller.signal.aborted && !receivedError && !reconnectingRunsRef.current.has(id)) updateRun(id, { error: "" });
        if (!reconnectingRunsRef.current.has(id)) updateRun(id, { isStreaming: false, finishedAt: Date.now() });
        controllersRef.current.delete(id);
        const activeSessionId = runSessionIdsRef.current.get(id);
        runSessionIdsRef.current.delete(id);
        if (activeSessionId) activeSessionIdsRef.current.delete(activeSessionId);
        if (request.sessionId) activeSessionIdsRef.current.delete(request.sessionId);
      }
    })();

    return true;
  }, [applyStreamEvent, updateRun]);

  /** 清除指定 run 的全部重连状态。 */
  const finishReconnect = useCallback((runId: string) => {
    reconnectingRunsRef.current.delete(runId);
    reconnectSessionIdsRef.current.delete(runId);
    reconnectAttemptsRef.current.delete(runId);
    reconnectFnsRef.current.delete(runId);
    const timer = reconnectTimersRef.current.get(runId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      reconnectTimersRef.current.delete(runId);
    }
  }, []);

  /**
   * 自动重连：对已绑定会话的运行重新接入 /api/chat/[sessionId]/stream 重放流。
   * 退避重试（1s/2s/4s/8s/16s 封顶）直到成功、服务端 404（任务已完成）或用户停止。
   */
  const scheduleReconnect = useCallback((runId: string, sessionId: string, callbacks: StreamCallbacks) => {
    if (reconnectTimersRef.current.has(runId) || reconnectingRunsRef.current.has(runId)) return;
    reconnectingRunsRef.current.add(runId);
    reconnectSessionIdsRef.current.set(runId, sessionId);
    updateRun(runId, { isStreaming: true, error: "连接已断开，正在自动重连…" });

    const attempt = () => {
      reconnectTimersRef.current.delete(runId);
      reconnectFnsRef.current.delete(runId);
      const controller = new AbortController();
      controllersRef.current.set(runId, controller);
      void (async () => {
        let terminalReceived = false;
        try {
          const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/stream`, { cache: "no-store", signal: controller.signal });
          if (response.status === 404) {
            // 服务端已无活跃运行：任务已完成，结束重连并刷新详情
            finishReconnect(runId);
            updateRun(runId, { isStreaming: false, finishedAt: Date.now(), error: "" });
            callbacks.onCompleted?.(sessionId, runId);
            return;
          }
          if (!response.ok) throw new Error(`无法恢复任务（HTTP ${response.status}）。`);
          if (!response.body) throw new Error("服务未返回可读取的数据流。");
          updateRun(runId, { error: "" });
          await readChatStreamEvents(response.body, (event) => {
            if (event.type === "done" || event.type === "error") terminalReceived = true;
            applyStreamEvent(runId, event, callbacks);
          });
          if (!terminalReceived && !controller.signal.aborted) throw new Error("连接再次中断。");
          finishReconnect(runId);
        } catch (caught) {
          if (!controller.signal.aborted) {
            const attemptCount = (reconnectAttemptsRef.current.get(runId) ?? 0) + 1;
            reconnectAttemptsRef.current.set(runId, attemptCount);
            const delay = reconnectDelayMs(attemptCount - 1);
            updateRun(runId, { error: "连接已断开，正在自动重连…", isStreaming: true });
            const fn = () => { attempt(); };
            reconnectFnsRef.current.set(runId, fn);
            reconnectTimersRef.current.set(runId, window.setTimeout(fn, delay));
          } else {
            finishReconnect(runId);
          }
        } finally {
          controllersRef.current.delete(runId);
        }
      })();
    };
    attempt();
  }, [applyStreamEvent, finishReconnect, updateRun]);

  const resume = useCallback((sessionId: string, callbacks: StreamCallbacks = {}) => {
    if (activeSessionIdsRef.current.has(sessionId)) return false;
    activeSessionIdsRef.current.add(sessionId);
    resumeAttemptedSessionIdsRef.current.add(sessionId);
    const id = nextRunId();
    const controller = new AbortController();
    controllersRef.current.set(id, controller);
    setRuns((current) => [...current.filter((run) => run.sessionId !== sessionId), { id, sessionId, pendingPrompt: "", tools: [], timeline: [], text: "", thinking: "", retry: null, runId: "", error: "", queued: { steering: [], followUp: [] }, stopping: false, tokenSpeed: 0, isStreaming: true, startedAt: Date.now(), finishedAt: null, replay: true }]);

    void (async () => {
      let terminalReceived = false;
      let receivedError = false;
      let activeRunFound = true;
      try {
        const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/stream`, { cache: "no-store", signal: controller.signal });
        if (response.status === 404) {
          activeRunFound = false;
          return;
        }
        if (!response.ok) {
          if (response.status < 500 && response.status !== 408 && response.status !== 429) receivedError = true;
          throw new Error(`无法恢复任务（HTTP ${response.status}）。`);
        }
        if (!response.body) throw new Error("服务未返回可读取的数据流。");
        await readChatStreamEvents(response.body, (event) => {
          if (event.type === "error") receivedError = true;
          if (event.type === "done" || event.type === "error") terminalReceived = true;
          applyStreamEvent(id, event, callbacks);
        });
        if (!terminalReceived && !controller.signal.aborted) throw new Error("恢复连接在任务完成前中断。");
      } catch (caught) {
        if (!controller.signal.aborted && !receivedError) {
          // 恢复流中断：进入自动重连（复用当前 run 的 id 与回调）
          reconnectingRunsRef.current.add(id);
          callbacksBySessionRef.current.set(sessionId, callbacks);
          scheduleReconnect(id, sessionId, callbacks);
        } else if (!controller.signal.aborted) {
          receivedError = true;
          updateRun(id, { error: caught instanceof Error ? caught.message : "无法恢复任务。" });
        }
      } finally {
        controllersRef.current.delete(id);
        runSessionIdsRef.current.delete(id);
        activeSessionIdsRef.current.delete(sessionId);
        if (!activeRunFound) setRuns((current) => current.filter((run) => run.id !== id));
        else if (!reconnectingRunsRef.current.has(id)) updateRun(id, { isStreaming: false, finishedAt: Date.now() });
        if (!receivedError && !activeRunFound) return;
      }
    })();
    return true;
  }, [applyStreamEvent, scheduleReconnect, updateRun]);

  /** 主动移除一条运行（详情刷新完成后调用，避免实时/历史重复渲染造成闪烁）。 */
  const removeRun = useCallback((runId: string) => {
    speedSamplesRef.current.delete(runId);
    setRuns((current) => current.filter((run) => run.id !== runId));
  }, []);

  const stop = useCallback((runId: string) => {
    updateRun(runId, { stopping: true });
    finishReconnect(runId);
    const controller = controllersRef.current.get(runId);
    const sessionId = runSessionIdsRef.current.get(runId);
    if (sessionId) {
      void fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).finally(() => controller?.abort());
      return;
    }
    controller?.abort();
  }, [updateRun]);

  // 根据当前选中的会话定位其运行状态；新会话（未绑定 id）返回第一个进行中的未绑定运行。
  const runFor = useCallback((sessionId: string | null): ChatRun | undefined => {
    if (sessionId) {
      const exact = runs.find((run) => run.sessionId === sessionId);
      if (exact) return exact;
      return undefined;
    }
    return runs.find((run) => run.sessionId === null && run.isStreaming);
  }, [runs]);

  const runningSessionIds = new Set(runs.filter((run) => run.isStreaming && run.sessionId).map((run) => run.sessionId as string));

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      for (const timer of reconnectTimersRef.current.values()) window.clearTimeout(timer);
      reconnectTimersRef.current.clear();
    };
  }, []);

  // 移动端切后台导致 SSE 断开：回到前台时立即重试所有等待中的自动重连
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      for (const [runId, fn] of reconnectFnsRef.current) {
        const timer = reconnectTimersRef.current.get(runId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          reconnectTimersRef.current.delete(runId);
          fn();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return { runs, runFor, runningSessionIds, send, resume, stop, removeRun };
}
