"use client";

import { useEffect, useRef } from "react";

export type SessionActivity = {
  id: string;
  sessionId: string;
  type: "run-start" | "run-end";
  createdAt: number;
};

type ActivityPayload = {
  type?: unknown;
  activity?: Partial<SessionActivity>;
};

function isSessionActivity(payload: ActivityPayload, sessionId: string): payload is { type: "activity"; activity: SessionActivity } {
  const activity = payload.activity;
  return payload.type === "activity"
    && typeof activity?.id === "string"
    && activity.sessionId === sessionId
    && (activity.type === "run-start" || activity.type === "run-end")
    && typeof activity.createdAt === "number";
}

/** Subscribes to FRQ activity for the session the user is currently viewing. */
export function useSessionActivity(sessionId: string | null, onActivity: (activity: SessionActivity) => void) {
  const onActivityRef = useRef(onActivity);
  const seenActivityIdsRef = useRef(new Set<string>());

  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    if (!sessionId) return;
    // 该流首连会回放历史活动。以建立订阅的时刻作为当前会话水位，只对其后新增的运行事件产生副作用。
    const connectedAt = Date.now();
    seenActivityIdsRef.current = new Set();
    const source = new EventSource(`/api/frq/activity/stream?sessionId=${encodeURIComponent(sessionId)}`);

    source.onmessage = (event) => {
      let payload: ActivityPayload;
      try {
        payload = JSON.parse(event.data) as ActivityPayload;
      } catch {
        return;
      }
      if (!isSessionActivity(payload, sessionId) || seenActivityIdsRef.current.has(payload.activity.id)) return;
      seenActivityIdsRef.current.add(payload.activity.id);
      if (payload.activity.createdAt < connectedAt) return;
      onActivityRef.current(payload.activity);
    };
    // EventSource reconnects by itself. Activity delivery is best effort, so errors stay silent.
    source.onerror = () => {};

    return () => source.close();
  }, [sessionId]);
}
