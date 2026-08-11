"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatRun } from "@/client/use-chat-stream";
import type { WorkbenchSettings } from "@/client/settings";

export type CompletionToastItem = {
  id: string;
  message: string;
  detail?: string;
  isError: boolean;
};

export type CompletionAlertMode = "off" | "page" | "desktop" | "both";

export type CompletionNotice = {
  runId: string;
  ok: boolean;
  title: string;
  detail?: string;
  /** null 表示该模式/可见性下不需要提示 */
  via: "toast" | "desktop" | null;
};

const TOAST_DURATION_OK_MS = 5_000;
const TOAST_DURATION_ERROR_MS = 8_000;
const MAX_TOASTS = 4;

/**
 * 纯函数：根据运行状态、提醒模式与页面可见性，规划一次执行结束后应触发的提示。
 * - 主动停止（stopping）与刷新恢复重放（replay）不打扰
 * - 页面可见：页面内 toast；页面不可见：系统通知
 */
export function planCompletionNotices(runs: ChatRun[], mode: CompletionAlertMode, pageVisible: boolean): CompletionNotice[] {
  const notices: CompletionNotice[] = [];
  for (const run of runs) {
    if (run.isStreaming || run.finishedAt === null) continue;
    if (run.replay || run.stopping) continue;
    if (mode === "off") continue;

    const ok = !run.error;
    const title = ok ? "任务已完成" : "任务执行失败";
    const detail = ok ? (run.pendingPrompt || undefined) : run.error;

    let via: CompletionNotice["via"] = null;
    if (mode === "page") {
      via = "toast";
    } else if (mode === "desktop") {
      via = pageVisible ? null : "desktop";
    } else if (mode === "both") {
      via = pageVisible ? "toast" : "desktop";
    }
    notices.push({ runId: run.id, ok, title, detail, via });
  }
  return notices;
}

/**
 * 监听一次执行（run）的结束：成功或失败都会触发提示。
 * - 页面可见：弹出页面内 toast（成功/失败样式区分）
 * - 页面不可见：改用浏览器桌面通知（需授权，未授权时自动请求）
 * - 主动停止（stopping）与刷新恢复重放（replay）不打扰
 */
export function useCompletionNotifier(runs: ChatRun[], settings: WorkbenchSettings) {
  const [toasts, setToasts] = useState<CompletionToastItem[]>([]);
  const notifiedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = (id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const pushToast = (item: CompletionToastItem) => {
    setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), item]);
    const timer = window.setTimeout(
      () => dismissToast(item.id),
      item.isError ? TOAST_DURATION_ERROR_MS : TOAST_DURATION_OK_MS,
    );
    timersRef.current.set(item.id, timer);
  };

  // 卸载时清理所有自动关闭定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const pageVisible = typeof document !== "undefined" && !document.hidden;
    for (const notice of planCompletionNotices(runs, settings.completionAlert, pageVisible)) {
      if (notifiedRef.current.has(notice.runId)) continue;
      notifiedRef.current.add(notice.runId);
      if (notice.via === "toast") {
        pushToast({ id: notice.runId, message: notice.title, detail: notice.detail, isError: !notice.ok });
      } else if (notice.via === "desktop") {
        void notifyDesktop(notice.title, notice.detail ?? "", !notice.ok);
      }
    }
  }, [runs, settings.completionAlert]);

  return { toasts, dismissToast };
}

async function notifyDesktop(title: string, body: string, isError: boolean) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
    }
    const notification = new Notification(title, {
      body,
      tag: `pi-completion-${Date.now()}`,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    // 失败通知更醒目：保持显示更久（部分平台不生效，属尽力而为）
    if (isError) {
      window.setTimeout(() => notification.close(), 15_000);
    }
  } catch {
    // 受限环境（如无通知中心）时静默降级
  }
}
