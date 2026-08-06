import type { WorkspaceFileMatch } from "@/workspace-contracts";

type FileMentionMenuProps = {
  matches: WorkspaceFileMatch[];
  activeIndex: number;
  loading: boolean;
  error: string;
  truncated: boolean;
  onSelect: (match: WorkspaceFileMatch) => void;
};

export function FileMentionMenu({ matches, activeIndex, loading, error, truncated, onSelect }: FileMentionMenuProps) {
  return (
    <div id="file-mention-menu" className="file-mention-menu" role="listbox" aria-label="文件引用建议">
      {loading ? <p className="file-mention-status" role="status">正在搜索文件…</p> : null}
      {error ? <p className="file-mention-status error" role="alert">{error}</p> : null}
      {!loading && !error && matches.length === 0 ? <p className="file-mention-status">没有匹配的文件</p> : null}
      {matches.map((match, index) => (
        <button
          className={`file-mention-option ${index === activeIndex ? "selected" : ""}`}
          id={`file-mention-${index}`}
          key={match.path}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(match)}
        >
          <strong>{match.name}</strong><span>{match.path}</span>
        </button>
      ))}
      {truncated ? <p className="file-mention-status">结果已截断，请继续输入以缩小范围。</p> : null}
    </div>
  );
}
