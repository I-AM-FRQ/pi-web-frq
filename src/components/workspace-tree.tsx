import { useCallback, useState, type CSSProperties, type MouseEvent } from "react";
import type { WorkspaceEntry } from "@/workspace-contracts";
import type { WorkspaceNode } from "@/client/use-workspace-tree";

type WorkspaceTreeProps = {
  nodes: Record<string, WorkspaceNode>;
  onLoadPath: (path: string) => void;
  onOpenFile: (path: string) => void;
};

type FileActionsProps = {
  path: string;
  name: string;
};

function downloadFile(path: string) {
  const anchor = document.createElement("a");
  anchor.href = `/api/workspace/download?path=${encodeURIComponent(path)}`;
  anchor.download = "";
  anchor.click();
}

import { copyTextToClipboard } from "@/client/clipboard";

function copyText(text: string) {
  void copyTextToClipboard(text).catch(() => undefined);
}

function FileActions({ path, name }: FileActionsProps) {
  const [open, setOpen] = useState(false);
  const copyPath = (event: MouseEvent) => {
    event.stopPropagation();
    copyText(path);
    setOpen(false);
  };
  const copyName = (event: MouseEvent) => {
    event.stopPropagation();
    copyText(name);
    setOpen(false);
  };
  const download = (event: MouseEvent) => {
    event.stopPropagation();
    downloadFile(path);
    setOpen(false);
  };

  return (
    <span className="tree-file-actions" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="tree-file-more"
        aria-label={`文件操作 ${path}`}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}
      >⋯</button>
      {open ? (
        <span className="tree-file-menu">
          <button type="button" onClick={copyPath}>复制路径</button>
          <button type="button" onClick={copyName}>复制文件名</button>
          <button type="button" onClick={download}>下载文件</button>
        </span>
      ) : null}
    </span>
  );
}

function TreeEntries({
  entries,
  nodes,
  expanded,
  onToggle,
  onOpenFile,
  depth,
}: {
  entries: WorkspaceEntry[];
  nodes: Record<string, WorkspaceNode>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  depth: number;
}) {
  return (
    <ul className="workspace-entries">
      {entries.map((entry) => {
        const node = nodes[entry.path];
        const isDirectory = entry.kind === "directory";
        const isExpanded = expanded.has(entry.path);
        return (
          <li key={entry.path} style={{ "--tree-depth": depth } as CSSProperties}>
            {isDirectory ? (
              <button
                className="tree-entry directory"
                type="button"
                onClick={() => onToggle(entry.path)}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "收起" : "展开"}目录 ${entry.path}`}
              >
                <span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span>{entry.name}
              </button>
            ) : (
              <span className="tree-file-row">
                <button className="tree-entry file" type="button" onClick={() => onOpenFile(entry.path)} aria-label={`预览文件 ${entry.path}`}><span aria-hidden="true">·</span>{entry.name}</button>
                <FileActions path={entry.path} name={entry.name} />
              </span>
            )}
            {isDirectory && isExpanded ? (
              <div className="tree-children">
                {node?.loading ? <p className="tree-status">读取中…</p> : null}
                {node?.error ? <p className="tree-status error">{node.error}</p> : null}
                {node && !node.loading && !node.error ? (
                  <TreeEntries entries={node.entries} nodes={nodes} expanded={expanded} onToggle={onToggle} onOpenFile={onOpenFile} depth={depth + 1} />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function WorkspaceTree({ nodes, onLoadPath, onOpenFile }: WorkspaceTreeProps) {
  const root = nodes["."];
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const canList = root?.capabilities?.list ?? false;

  const toggle = useCallback((path: string) => {
    const opening = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(path);
      else next.delete(path);
      return next;
    });
    if (opening) onLoadPath(path);
  }, [expanded, onLoadPath]);

  return (
    <section className="workspace-tree" aria-labelledby="workspace-heading">
      <div className="workspace-tree-heading"><h2 id="workspace-heading">工作区</h2><span>相对路径</span></div>
      {root?.loading ? <p className="tree-status">正在读取工作区…</p> : null}
      {root?.error ? <p className="tree-status error">{root.error}</p> : null}
      {!root?.loading && !root?.error && root ? (
        canList ? <TreeEntries entries={root.entries} nodes={nodes} expanded={expanded} onToggle={toggle} onOpenFile={onOpenFile} depth={0} /> : <p className="tree-status">当前工作区不可浏览</p>
      ) : null}
    </section>
  );
}
