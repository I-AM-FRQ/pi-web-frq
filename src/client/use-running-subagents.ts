"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TaskEvent = {
  seq: number;
  ts: string | number;
  kind: "thinking" | "text" | "tool" | "status";
  data: {
    content?: string;
    delta?: string;
    id?: string;
    name?: string;
    label?: string;
    result?: string;
    isError?: boolean;
    status?: string;
    running?: boolean;
  };
};

export type TaskSnapshot = {
  taskId: string;
  task?: string;
  nickname: string;
  agentName: string;
  agentSource: string;
  model?: string;
  sessionMode: "persistent" | "ephemeral";
  status: string;
  startTime?: string | number | null;
  finishTime?: string | number | null;
  errorMessage?: string;
  outputs: string[];
  actions: string[];
  events: TaskEvent[];
};

type StreamPayload =
  | { type: "snapshot"; tasks: TaskSnapshot[] }
  | { type: "update"; task: TaskSnapshot }; 

const RUNNING_STATUSES = new Set(["pending", "queued", "running"]);

function startTimeValue(task: TaskSnapshot): number {
  if (!task.startTime) return 0;
  if (typeof task.startTime === "number") return task.startTime;
  const parsed = Date.parse(task.startTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodePayload(raw: string): StreamPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    if (parsed.type === "snapshot" && "tasks" in parsed && Array.isArray(parsed.tasks)) return parsed as StreamPayload;
    if (parsed.type === "update" && "task" in parsed && parsed.task && typeof parsed.task === "object" && "taskId" in parsed.task) return parsed as StreamPayload;
  } catch {
    // A later EventSource snapshot recovers from malformed transient data.
  }
  return null;
}

/** Subscribe to the FRQ task feed; server snapshots are the authoritative state. */
export function useRunningSubagents(sessionId: string | null | undefined) {
  const [tasksById, setTasksById] = useState<Map<string, TaskSnapshot>>(() => new Map());
  const [isLoading, setIsLoading] = useState(Boolean(sessionId));
  const sourceRef = useRef<EventSource | null>(null);

  const replaceSnapshot = useCallback((tasks: TaskSnapshot[]) => {
    setTasksById(() => new Map(tasks.map((task) => [task.taskId, task])));
  }, []);

  const mergeUpdate = useCallback((update: TaskSnapshot) => {
    setTasksById((current) => {
      const next = new Map(current);
      next.set(update.taskId, { ...current.get(update.taskId), ...update });
      return next;
    });
  }, []);

  useEffect(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    let disposed = false;
    if (!sessionId) {
      queueMicrotask(() => {
        if (!disposed) {
          setTasksById(new Map());
          setIsLoading(false);
        }
      });
      return;
    }

    const encodedSessionId = encodeURIComponent(sessionId);
    const accept = (payload: StreamPayload) => {
      if (payload.type === "snapshot") replaceSnapshot(payload.tasks);
      else mergeUpdate(payload.task);
      setIsLoading(false);
    };

    const source = new EventSource(`/api/frq/tasks/stream?sessionId=${encodedSessionId}`);
    sourceRef.current = source;
    source.onmessage = (event) => {
      if (disposed) return;
      const payload = decodePayload(event.data);
      if (payload) accept(payload);
    };
    // EventSource reconnects itself and the server replays a snapshot.
    source.onerror = () => {};

    return () => {
      disposed = true;
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [mergeUpdate, replaceSnapshot, sessionId]);

  const allTasks = useMemo(() => [...tasksById.values()].sort((left, right) => startTimeValue(left) - startTimeValue(right)), [tasksById]);
  const runningTasks = useMemo(() => allTasks.filter((task) => RUNNING_STATUSES.has(task.status)), [allTasks]);
  const getTaskEvents = useCallback((taskId: string) => tasksById.get(taskId)?.events ?? [], [tasksById]);

  return { runningTasks, allTasks, getTaskEvents, isLoading };
}
