"use client";

import { useState, type CSSProperties } from "react";
import type { SessionTreeNode } from "@/contracts";

type SessionTreeProps = {
  tree: SessionTreeNode[];
  disabled: boolean;
  activeLeafId: string | null;
  previewEntryId: string | null;
  branchFromEntryId?: string;
  truncated: boolean;
  onPreview: (entryId: string) => void;
  onFork: (entryId: string) => void;
  onContinue: (entryId: string) => void;
};

const kindLabel: Record<SessionTreeNode["kind"], string> = {
  user: "你",
  assistant: "结果",
  tool: "工具",
  summary: "摘要",
  setting: "设置",
  metadata: "记录",
};

function canBranch(node: SessionTreeNode) {
  return node.kind === "user" || node.kind === "assistant";
}

function TreeNodes({ nodes, depth, disabled, activeLeafId, previewEntryId, branchFromEntryId, onPreview, onFork, onContinue }: {
  nodes: SessionTreeNode[];
  depth: number;
  disabled: boolean;
  activeLeafId: string | null;
  previewEntryId: string | null;
  branchFromEntryId?: string;
  onPreview: (entryId: string) => void;
  onFork: (entryId: string) => void;
  onContinue: (entryId: string) => void;
}) {
  return (
    <ul className="session-tree-nodes">
      {nodes.map((node) => {
        const branchable = canBranch(node);
        const currentLeaf = activeLeafId === node.id;
        const previewing = previewEntryId === node.id;
        return (
          <li key={node.id} style={{ "--session-tree-depth": depth } as CSSProperties}>
            <div className={`session-tree-node ${node.kind} ${currentLeaf ? "active-leaf" : ""} ${previewing ? "previewing" : ""} ${branchFromEntryId === node.id ? "selected" : ""}`} title={node.label}>
              <span>{currentLeaf ? "当前" : kindLabel[node.kind]}</span><p>{node.label}</p>
              {branchable ? (
                <span className="session-tree-actions">
                  <button type="button" disabled={disabled} onClick={() => onPreview(node.id)}>{previewing ? "正在查看" : "查看"}</button>
                  <button type="button" disabled={disabled} onClick={() => onContinue(node.id)}>{branchFromEntryId === node.id ? "将从此继续" : "从此继续"}</button>
                  <button type="button" disabled={disabled} onClick={() => onFork(node.id)}>复制</button>
                </span>
              ) : null}
            </div>
            {node.children.length > 0 ? (
              <TreeNodes
                nodes={node.children}
                depth={depth + 1}
                disabled={disabled}
                activeLeafId={activeLeafId}
                previewEntryId={previewEntryId}
                branchFromEntryId={branchFromEntryId}
                onPreview={onPreview}
                onFork={onFork}
                onContinue={onContinue}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function SessionTree({ tree, disabled, activeLeafId, previewEntryId, branchFromEntryId, truncated, onPreview, onFork, onContinue }: SessionTreeProps) {
  const [open, setOpen] = useState(false);
  if (tree.length === 0) return null;

  return (
    <section className="session-tree" aria-labelledby="session-tree-heading">
      <button id="session-tree-heading" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span>会话结构</span><small>{open ? "收起" : "展开"}</small>
      </button>
      {open ? <><TreeNodes nodes={tree} depth={0} disabled={disabled} activeLeafId={activeLeafId} previewEntryId={previewEntryId} branchFromEntryId={branchFromEntryId} onPreview={onPreview} onFork={onFork} onContinue={onContinue} />{truncated ? <p className="session-tree-truncated">仅显示最近节点，避免超大历史影响性能。</p> : null}</> : null}
    </section>
  );
}
