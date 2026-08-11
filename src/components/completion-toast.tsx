"use client";

import type { CompletionToastItem } from "@/client/use-completion-notifier";

export function CompletionToast({ toasts, onDismiss }: {
  toasts: CompletionToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="completion-toasts" role="region" aria-label="执行完成提醒">
      {toasts.map((toast) => (
        <div key={toast.id} className={`completion-toast${toast.isError ? " error" : ""}`} role={toast.isError ? "alert" : "status"}>
          <span className="completion-toast-icon" aria-hidden="true">{toast.isError ? "✕" : "✓"}</span>
          <div className="completion-toast-body">
            <strong>{toast.message}</strong>
            {toast.detail ? <span className="completion-toast-detail">{toast.detail}</span> : null}
          </div>
          <button type="button" className="completion-toast-close" onClick={() => onDismiss(toast.id)} aria-label="关闭提示" title="关闭">×</button>
        </div>
      ))}
    </div>
  );
}
