import { useState } from "react";
import type { WorkspaceGitBranches, WorkspaceGitCommit, WorkspaceGitDiffMode, WorkspaceGitStatus } from "@/workspace-contracts";

type WorkspaceGitStatusProps = {
  status: WorkspaceGitStatus | null;
  loading: boolean;
  error: string;
  branches: WorkspaceGitBranches | null;
  commits: WorkspaceGitCommit[];
  actionLoading: boolean;
  actionError: string;
  onRefresh: () => void;
  onOpenDiff: (path: string, mode: WorkspaceGitDiffMode) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (message: string) => void;
  onSwitch: (branch: string) => void;
};

function statusLabel(indexStatus: string, worktreeStatus: string) {
  const status = `${indexStatus}${worktreeStatus}`;
  if (status.includes("?")) return "未跟踪";
  if (status.includes("A")) return "新增";
  if (status.includes("D")) return "删除";
  if (status.includes("R")) return "重命名";
  return "修改";
}

function hasStagedDiff(indexStatus: string) {
  return indexStatus !== " " && indexStatus !== "?";
}

function hasWorkingDiff(worktreeStatus: string) {
  return worktreeStatus !== " " && worktreeStatus !== "?";
}

export function WorkspaceGitStatus({ status, loading, error, branches, commits, actionLoading, actionError, onRefresh, onOpenDiff, onStage, onUnstage, onCommit, onSwitch }: WorkspaceGitStatusProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const stagedCount = status?.entries.filter((entry) => hasStagedDiff(entry.indexStatus)).length ?? 0;

  const submitCommit = () => {
    const message = commitMessage.trim();
    if (!message || actionLoading) return;
    onCommit(message);
    setCommitMessage("");
  };

  return (
    <section className="workspace-git" aria-labelledby="git-heading">
      <div className="workspace-tree-heading">
        <h2 id="git-heading">Git 状态</h2>
        <button className="workspace-git-refresh" type="button" onClick={onRefresh} disabled={loading || actionLoading}>{loading ? "读取中" : "刷新"}</button>
      </div>
      {error ? <p className="tree-status error">{error}</p> : null}
      {actionError ? <p className="tree-status error">{actionError}</p> : null}
      {!loading && !error && status && !status.available ? <p className="tree-status">当前工作区不是 Git 仓库</p> : null}
      {!loading && !error && status?.available ? (
        <>
          <p className="workspace-git-branch">
            {status.branch || "DETACHED HEAD"} · {status.entries.length} 项变更
            {branches && branches.branches.length > 0 ? (
              <span className="workspace-git-branch-switch">
                <button type="button" onClick={() => setBranchMenuOpen((current) => !current)} disabled={actionLoading} aria-expanded={branchMenuOpen}>切换分支 ⌄</button>
                {branchMenuOpen ? (
                  <span className="workspace-git-branch-menu">
                    {branches.branches.map((branch) => <button key={branch} type="button" className={branch === (branches.current ?? status.branch) ? "selected" : ""} onClick={() => { setBranchMenuOpen(false); if (branch !== (branches.current ?? status.branch)) onSwitch(branch); }}>{branch}{branch === (branches.current ?? status.branch) ? " ✓" : ""}</button>)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </p>
          {status.entries.length === 0 ? <p className="tree-status">工作区干净</p> : null}
          <ul className="workspace-git-entries">
            {status.entries.map((entry) => {
              const staged = hasStagedDiff(entry.indexStatus);
              const working = hasWorkingDiff(entry.worktreeStatus);
              return (
                <li key={`${entry.indexStatus}${entry.worktreeStatus}:${entry.path}`}>
                  <div>
                    <span>{statusLabel(entry.indexStatus, entry.worktreeStatus)}</span><code>{entry.path}</code>
                    <small>{entry.indexStatus}{entry.worktreeStatus}</small>
                  </div>
                  <p>
                    {working ? <button type="button" onClick={() => onOpenDiff(entry.path, "working")}>工作区</button> : null}
                    {staged ? <button type="button" onClick={() => onOpenDiff(entry.path, "staged")}>暂存区</button> : null}
                    {!working && !staged ? <span>无文本差异</span> : null}
                    {staged ? <button type="button" disabled={actionLoading} onClick={() => onUnstage([entry.path])}>取消暂存</button> : working || entry.indexStatus === "?" ? <button type="button" disabled={actionLoading} onClick={() => onStage([entry.path])}>暂存</button> : null}
                  </p>
                </li>
              );
            })}
          </ul>
          {status.truncated ? <p className="tree-status">变更列表已截断</p> : null}
          <div className="workspace-git-commit">
            <input type="text" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitCommit(); } }} placeholder={stagedCount > 0 ? `提交 ${stagedCount} 项已暂存更改…` : "提交信息（请先暂存更改）"} maxLength={2000} disabled={actionLoading} />
            <button type="button" onClick={submitCommit} disabled={actionLoading || !commitMessage.trim() || stagedCount === 0}>提交</button>
          </div>
          {commits.length > 0 ? (
            <div className="workspace-git-log">
              <h3>最近提交</h3>
              <ul>{commits.map((commit) => <li key={commit.hash} title={commit.message}><code>{commit.hash}</code><span>{commit.message}</span></li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
