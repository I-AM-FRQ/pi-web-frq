"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatFileReference } from "@/client/file-references";
import { useWorkspaceFile } from "@/client/use-workspace-file";
import { copyTextToClipboard } from "@/client/clipboard";
import { ChatMarkdown } from "@/components/chat-markdown";
import type { WorkspaceFilePreview as WorkspaceFilePreviewData } from "@/workspace-contracts";

type WorkspaceFilePreviewProps = {
  path: string | null;
  projectId: string | null;
  initialLine?: number | null;
  onClose: () => void;
  onInsert: (reference: string) => void;
};

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownFile(path: string) {
  return /\.md(?:own|x)?$/i.test(path);
}

type WorkspaceFileContentProps = {
  codeRef: React.RefObject<HTMLDivElement | null>;
  file: WorkspaceFilePreviewData;
  initialLine?: number | null;
  lines: string[];
  onSelectLine: (line: number, extend: boolean) => void;
  selection: { start: number; end: number } | null;
};

function WorkspaceFileContent({ codeRef, file, initialLine, lines, onSelectLine, selection }: WorkspaceFileContentProps) {
  const supportsMarkdownPreview = isMarkdownFile(file.path);
  const [viewMode, setViewMode] = useState<"rendered" | "source">(supportsMarkdownPreview && !initialLine ? "rendered" : "source");
  const effectiveSelection = selection ?? (initialLine ? { start: initialLine, end: initialLine } : null);
  const showingRenderedMarkdown = supportsMarkdownPreview && viewMode === "rendered";

  return <>
    {supportsMarkdownPreview ? <div className="file-preview-view-toggle" role="tablist" aria-label="文件查看方式"><button type="button" role="tab" aria-selected={showingRenderedMarkdown} className={showingRenderedMarkdown ? "selected" : ""} onClick={() => setViewMode("rendered")}>格式化</button><button type="button" role="tab" aria-selected={!showingRenderedMarkdown} className={!showingRenderedMarkdown ? "selected" : ""} onClick={() => setViewMode("source")}>原文</button></div> : null}
    {file.truncated ? <p className="file-preview-notice">仅显示安全预览中的前 {lines.length} 行；引用仍由 Agent 使用工作区工具读取。</p> : null}
    {showingRenderedMarkdown ? <div className="file-preview-markdown" aria-label={`${file.path} 格式化内容`}><ChatMarkdown content={file.content} /></div> : <><p className="file-preview-help">点击选择单行，按住 Shift 点击以选择行范围。</p><div className="file-preview-code" ref={codeRef} aria-label={`${file.path} 内容`}>
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const selected = effectiveSelection && lineNumber >= effectiveSelection.start && lineNumber <= effectiveSelection.end;
        return <button className={`file-preview-line ${selected ? "selected" : ""}`} key={lineNumber} type="button" data-line={lineNumber} onClick={(event) => onSelectLine(lineNumber, event.shiftKey)} aria-pressed={Boolean(selected)}><span aria-hidden="true">{lineNumber}</span><code>{line || " "}</code></button>;
      })}
    </div></>}
  </>;
}

export function WorkspaceFilePreview({ path, projectId, initialLine, onClose, onInsert }: WorkspaceFilePreviewProps) {
  const { file, loading, error, loadFile, clear } = useWorkspaceFile(projectId);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const isOpen = Boolean(path);
  const lines = useMemo(() => file?.content.split("\n") ?? [], [file]);

  useEffect(() => {
    if (path) void loadFile(path);
    else clear();
  }, [clear, initialLine, loadFile, path, projectId]);

  // 内容搜索命中时滚动到对应行（选中状态由 initialLine 派生，不触发额外渲染）。
  useEffect(() => {
    if (!file || !initialLine) return;
    const line = codeRef.current?.querySelector(`.file-preview-line[data-line="${initialLine}"]`);
    line?.scrollIntoView({ block: "center" });
  }, [file, initialLine]);

  const effectiveSelection = selection ?? (file && initialLine ? { start: initialLine, end: initialLine } : null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const insertReference = () => {
    if (!file) return;
    onInsert(formatFileReference(file.path, selection?.start, selection?.end));
    onClose();
  };

  const copyContent = () => {
    if (!file) return;
    void copyTextToClipboard(file.content).catch(() => undefined);
  };

  const selectLine = (line: number, extend: boolean) => {
    setSelection((current) => {
      if (!extend || !current || !file || current.start > file.totalLines) return { start: line, end: line };
      const anchor = current.end === current.start ? current.start : current.start;
      return { start: Math.min(anchor, line), end: Math.max(anchor, line) };
    });
  };

  return (
    <div className="file-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="file-preview" role="dialog" aria-modal="true" aria-labelledby="file-preview-heading">
        <header className="file-preview-header">
          <div><p>文件预览</p><h2 id="file-preview-heading">{path}</h2></div>
          <button className="file-preview-close" type="button" onClick={onClose} aria-label="关闭文件预览">×</button>
        </header>
        {loading ? <p className="file-preview-status" role="status">正在安全读取文件…</p> : null}
        {error ? <p className="file-preview-status error" role="alert">{error}</p> : null}
        {file ? (
          <>
            <div className="file-preview-meta"><span>{file.totalLines} 行 · {formatSize(file.sizeBytes)}{file.modifiedAt ? ` · ${new Date(file.modifiedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>{file.truncated ? <span className="file-preview-truncated">内容已截断</span> : null}</div>
            <WorkspaceFileContent key={`${file.path}:${initialLine ?? "all"}`} file={file} initialLine={initialLine} lines={lines} selection={selection} onSelectLine={selectLine} codeRef={codeRef} />
          </>
        ) : null}
        <footer className="file-preview-actions">
          <span>{effectiveSelection ? `已选择第 ${effectiveSelection.start}${effectiveSelection.end !== effectiveSelection.start ? `–${effectiveSelection.end}` : ""} 行` : "未选择行：将引用整个文件"}</span>
          <span className="file-preview-button-group">
            <button className="file-preview-copy" type="button" disabled={!file} onClick={copyContent}>复制内容</button>
            <button className="send-button" type="button" disabled={!file} onClick={insertReference}>{selection ? "插入选中行引用" : "插入整个文件引用"}</button>
          </span>
        </footer>
      </section>
    </div>
  );
}
