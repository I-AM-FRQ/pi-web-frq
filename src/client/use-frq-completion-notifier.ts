"use client";

import { useEffect, useRef, useState } from "react";
import type { CompletionAlertMode, CompletionToastItem } from "@/client/use-completion-notifier";

type FrqCompletionNotification = {
  id: string;
  sessionId: string;
  taskId: string;
  nickname: string;
  status: "done" | "failed" | "killed" | "timeout";
  summary: string;
};

const MAX_TOASTS = 4;

function notifyDesktop(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission === "denied") return;
    const send = () => new Notification(title, { body, tag: "pi-frq-" + Date.now() });
    if (Notification.permission === "granted") send();
    else void Notification.requestPermission().then((permission) => { if (permission === "granted") send(); });
  } catch {
    // Browser notification support is optional; the in-page toast remains available.
  }
}

/** Receives durable FRQ completion events independently of an active chat turn. */
export function useFrqCompletionNotifier(sessionId: string | null, mode: CompletionAlertMode) {
  const [toasts, setToasts] = useState<CompletionToastItem[]>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  const dismissToast = (id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  useEffect(() => {
    if (!sessionId || mode === "off") return;
    const source = new EventSource("/api/frq/notifications/stream?sessionId=" + encodeURIComponent(sessionId));
    source.onmessage = (event) => {
      let payload: { type?: string; notification?: FrqCompletionNotification };
      try { payload = JSON.parse(event.data) as typeof payload; } catch { return; }
      const notification = payload.type === "completion" ? payload.notification : undefined;
      if (!notification || seen.current.has(notification.id)) return;
      seen.current.add(notification.id);

      const ok = notification.status === "done";
      const title = ok ? "子代理完成：" + notification.nickname : "子代理结束：" + notification.nickname;
      const detail = notification.summary.slice(0, 300);
      const useDesktop = (mode === "desktop" || mode === "both") && document.hidden;
      if (useDesktop) notifyDesktop(title, detail);
      else if (mode !== "desktop") {
        setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id: notification.id, message: title, detail, isError: !ok }]);
        const duration = ok ? 8_000 : 12_000;
        timers.current.set(notification.id, window.setTimeout(() => dismissToast(notification.id), duration));
      }

      void fetch("/api/frq/notifications/ack?sessionId=" + encodeURIComponent(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notification.id] }),
      }).catch(() => {
        // A fresh page reconnect replays unacknowledged notifications.
      });
    };
    return () => source.close();
  }, [sessionId, mode]);

  return { toasts, dismissToast };
}
