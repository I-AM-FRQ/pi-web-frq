import { useEffect } from "react";
import type { WorkspaceGitDiff } from "@/workspace-contracts";

type WorkspaceGitDiffProps = {
  diff: WorkspaceGitDiff | null;
  loading: boolean;
  error: string;
  onClose: () => void;
};

export function WorkspaceGitDiff({ diff, loading, error, onClose }: WorkspaceGitDiffProps) {
  const isOpen = loading || Boolean(error) || Boolean(diff);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="file-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="file-preview git-diff-preview" role="dialog" aria-modal="true" aria-labelledby="git-diff-heading">
        <header className="file-preview-header">
          <div><p>Git Diff · {diff?.mode === "staged" ? "暂存区" : "工作区"}</p><h2 id="git-diff-heading">{diff?.path || "正在读取差异"}</h2></div>
          <button className="file-preview-close" type="button" onClick={onClose} aria-label="关闭 Git 差异">×</button>
        </header>
        {loading ? <p className="file-preview-status" role="status">正在安全读取 Git 差异…</p> : null}
        {error ? <p className="file-preview-status error" role="alert">{error}</p> : null}
        {diff ? (
          <>
            {diff.truncated ? <p className="file-preview-notice">差异内容已截断。</p> : null}
            <pre className="git-diff-content">{diff.content || "该文件在所选范围内没有可显示的文本差异。"}</pre>
          </>
        ) : null}
      </section>
    </div>
  );
}
