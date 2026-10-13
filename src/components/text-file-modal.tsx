"use client";

import { useEffect, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";

type TextFileModalProps = {
  path: string;
  onClose: () => void;
};

/** 文本类文件：直接读内容并用 markdown 渲染（复用聊天渲染，表格/代码块/链接都能正常显示）。 */
export function TextFileModal({ path, onClose }: TextFileModalProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/local-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(payload.error?.message ?? `读取失败（HTTP ${response.status}）`);
        }
        const text = await response.text();
        if (!cancelled) setContent(text);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "无法读取文件。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copyPath = () => {
    void navigator.clipboard?.writeText(path).catch(() => undefined);
  };

  return (
    <div className="text-file-backdrop" role="dialog" aria-modal="true" aria-label={`文件 ${name}`} onClick={onClose}>
      <div className="text-file-panel" onClick={(event) => event.stopPropagation()}>
        <header className="text-file-header">
          <div className="text-file-title">
            <strong>{name}</strong>
            <button type="button" className="text-file-path" onClick={copyPath} title="点击复制完整路径">{path}</button>
          </div>
          <div className="text-file-actions">
            <a className="text-file-download" href={`/api/local-file?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer noopener" title="在新窗口打开">打开</a>
            <button type="button" className="text-file-close" onClick={onClose} aria-label="关闭" title="关闭（Esc）">×</button>
          </div>
        </header>
        <div className="text-file-body">
          {loading ? <p className="text-file-status">正在读取…</p> : null}
          {error ? <p className="text-file-error" role="alert">{error}</p> : null}
          {!loading && !error ? <ChatMarkdown content={content || "（空文件）"} /> : null}
        </div>
      </div>
    </div>
  );
}
