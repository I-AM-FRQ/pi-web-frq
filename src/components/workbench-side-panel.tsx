"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspaceFileSearch, type WorkspaceSearchMode } from "@/client/use-workspace-file-search";
import type { SessionDetail } from "@/contracts";
import type { WorkspaceGitDiffMode } from "@/workspace-contracts";
import type { WorkspaceNode } from "@/client/use-workspace-tree";
import { WorkspaceGitStatus } from "@/components/workspace-git-status";
import { WorkspaceTree } from "@/components/workspace-tree";
import type { WorkspaceGitState } from "@/client/use-workspace-git";

import { AgentDescriptorItem, SubagentActivityItem, isSubagentRunning } from "@/components/subagent-panel";
import type { AgentDescriptor, SubagentActivity } from "@/contracts";

type PanelTab = "files" | "search" | "git" | "session" | "subagent";

type WorkbenchSidePanelProps = {
  nodes: Record<string, WorkspaceNode>;
  onLoadPath: (path: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  git: Pick<WorkspaceGitState, "status" | "loading" | "error" | "refresh" | "openDiff" | "branches" | "commits" | "actionLoading" | "actionError" | "runAction">;
  detail: SessionDetail | null;
  isLoadingSession: boolean;
  projectId: string | null;
  collapsed?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  subagents: SubagentActivity[];
  agents: AgentDescriptor[];
  agentsLoading: boolean;
  agentsError: string;
};

const tabs: Array<{ id: PanelTab; label: string }> = [
  { id: "files", label: "资源" },
  { id: "search", label: "搜索" },
  { id: "git", label: "Git" },
  { id: "session", label: "会话" },
  { id: "subagent", label: "子代理" },
];

const RECENT_FILES_KEY = "pi-workbench-recent-files";
const MAX_RECENT_FILES = 8;

function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT_FILES) : [];
  } catch {
    return [];
  }
}

function formatTokens(tokens: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function formatContext(detail: SessionDetail) {
  const { context } = detail;
  if (!context) return "打开此面板后计算";
  if (context.contextWindow === null || context.percent === null) return `${formatTokens(context.tokens)} Token（估算）`;
  return `${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)}（${context.percent.toFixed(1)}%）`;
}

export function WorkbenchSidePanel({ nodes, onLoadPath, onOpenFile, git, detail, isLoadingSession, projectId, collapsed, mobileOpen = false, onCloseMobile, subagents, agents, agentsLoading, agentsError }: WorkbenchSidePanelProps) {
  const [tab, setTab] = useState<PanelTab>("files");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<WorkspaceSearchMode>("name");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const search = useWorkspaceFileSearch(query, projectId, searchMode, { caseSensitive, regex });

  useEffect(() => {
    const timer = window.setTimeout(() => setRecentFiles(loadRecentFiles()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openFile = useCallback((path: string, line?: number) => {
    setRecentFiles((current) => {
      const next = [path, ...current.filter((item) => item !== path)].slice(0, MAX_RECENT_FILES);
      try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next)); } catch { /* 忽略持久化失败 */ }
      return next;
    });
    onOpenFile(path, line);
    onCloseMobile?.();
  }, [onCloseMobile, onOpenFile]);

  return (
    <aside className={`workbench-side-panel${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`} aria-label="工作区工具">
      <header className="mobile-drawer-header"><h2>工作区</h2><button type="button" onClick={onCloseMobile} aria-label="关闭工作区">×</button></header>
      <header className="workbench-side-header">
        <div><p>WORKSPACE</p><h2>{projectId ? "项目工作区" : "默认工作区"}</h2></div>
        <span>只读</span>
      </header>
      <nav className="workbench-side-tabs" aria-label="工作台视图">
        {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "selected" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>
      <div className="workbench-side-content">
        {tab === "files" ? (
          <>
            {recentFiles.length > 0 ? (
              <section className="recent-files" aria-labelledby="recent-files-heading">
                <div className="recent-files-heading"><h3 id="recent-files-heading">最近打开</h3><button type="button" onClick={() => { setRecentFiles([]); try { localStorage.removeItem(RECENT_FILES_KEY); } catch { /* 忽略 */ } }} aria-label="清除最近文件">清除</button></div>
                <ul>{recentFiles.map((path) => <li key={path}><button type="button" onClick={() => openFile(path)} title={path}><span aria-hidden="true">·</span>{path}</button></li>)}</ul>
              </section>
            ) : null}
            <WorkspaceTree nodes={nodes} onLoadPath={onLoadPath} onOpenFile={openFile} />
          </>
        ) : null}
        {tab === "search" ? (
          <section className="workspace-search" aria-labelledby="workspace-search-heading">
            <div className="workspace-search-heading">
              <label id="workspace-search-heading">查找</label>
              <div className="workspace-search-modes" role="tablist" aria-label="搜索模式">
                <button type="button" role="tab" aria-selected={searchMode === "name"} className={searchMode === "name" ? "selected" : ""} onClick={() => setSearchMode("name")}>文件名</button>
                <button type="button" role="tab" aria-selected={searchMode === "content"} className={searchMode === "content" ? "selected" : ""} onClick={() => setSearchMode("content")}>内容</button>
              </div>
            </div>
            <div className="workspace-search-row">
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchMode === "content" ? "搜索文件内容" : "输入文件名或路径"} autoComplete="off" />
              {searchMode === "content" ? (
                <span className="workspace-search-options">
                  <button type="button" className={caseSensitive ? "selected" : ""} onClick={() => setCaseSensitive((current) => !current)} title="区分大小写" aria-pressed={caseSensitive}>Aa</button>
                  <button type="button" className={regex ? "selected" : ""} onClick={() => setRegex((current) => !current)} title="正则表达式" aria-pressed={regex}>.*</button>
                </span>
              ) : null}
            </div>
            {search.loading ? <p className="tree-status">正在搜索…</p> : null}
            {search.error ? <p className="tree-status error">{search.error}</p> : null}
            {!query.trim() ? <p className="tree-status">{searchMode === "content" ? "在工作区文本文件中查找内容。支持忽略大小写与正则。" : "仅搜索允许预览的相对路径文件。"}</p> : null}
            {searchMode === "name" && search.matches.length > 0 ? <ul className="workspace-search-results">{search.matches.map((match) => <li key={match.path}><button type="button" onClick={() => openFile(match.path)}><strong>{match.name}</strong><code>{match.path}</code></button></li>)}</ul> : null}
            {searchMode === "content" && search.contentMatches.length > 0 ? <ul className="workspace-search-results content">{search.contentMatches.map((match) => <li key={`${match.path}:${match.line}`}><button type="button" onClick={() => openFile(match.path, match.line)}><code className="content-location">{match.path}:{match.line}</code><span className="content-text">{match.text || " "}</span></button></li>)}</ul> : null}
            {search.truncated ? <p className="tree-status">搜索结果已截断</p> : null}
          </section>
        ) : null}
        {tab === "git" ? <WorkspaceGitStatus status={git.status} loading={git.loading} error={git.error} branches={git.branches} commits={git.commits} actionLoading={git.actionLoading} actionError={git.actionError} onRefresh={() => { void git.refresh(); }} onOpenDiff={(path, mode: WorkspaceGitDiffMode) => { void git.openDiff(path, mode); }} onStage={(paths) => { void git.runAction({ action: "stage", paths }); }} onUnstage={(paths) => { void git.runAction({ action: "unstage", paths }); }} onCommit={(message) => { void git.runAction({ action: "commit", message }); }} onSwitch={(branch) => { void git.runAction({ action: "switch", branch }); }} /> : null}
        {tab === "session" ? (
          <section className="session-inspector" aria-labelledby="session-inspector-heading">
            <h3 id="session-inspector-heading">当前会话</h3>
            {isLoadingSession ? <p className="tree-status">正在读取会话…</p> : null}
            {!isLoadingSession && !detail ? <p className="tree-status">新会话将在首条回复后保存。</p> : null}
            {detail ? <dl>
              <div><dt>范围</dt><dd>{detail.context?.scope === "preview" ? "正在查看的分支" : "当前分支"}</dd></div>
              <div><dt>上下文</dt><dd>{formatContext(detail)}</dd></div>
              <div><dt>压缩</dt><dd>{detail.context ? (detail.context.compacted ? "存在已压缩上下文" : "未压缩") : "打开此面板后计算"}</dd></div>
              <div><dt>消息</dt><dd>{detail.session.messageCount}</dd></div>
              <div><dt>计费记录</dt><dd>{detail.usage.usageRecords}</dd></div>
              <div><dt>累计 Token</dt><dd>{formatTokens(detail.usage.totalTokens)}</dd></div>
              <div><dt>成本</dt><dd>US${detail.usage.cost.toFixed(4)}</dd></div>
              <div><dt>更新</dt><dd>{new Date(detail.session.updatedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</dd></div>
            </dl> : null}
          </section>
        ) : null}
        {tab === "subagent" ? (
          <section className="subagent-panel" aria-labelledby="subagent-panel-heading">
            <h3 id="subagent-panel-heading">运行活动</h3>
            {subagents.length === 0 ? <p className="tree-status">尚无子代理调用。让主模型使用 subagent 工具后，这里会实时显示每个子代理的对话过程。</p> : null}
            {(() => {
              const running = subagents.filter((activity) => isSubagentRunning(activity));
              const completed = subagents.filter((activity) => !isSubagentRunning(activity));
              return (
                <>
                  {running.length > 0 ? (
                    <section className="subagent-group" aria-labelledby="subagent-group-running">
                      <h4 id="subagent-group-running">运行中</h4>
                      <div className="subagent-activities">
                        {running.map((activity) => <SubagentActivityItem key={activity.id} activity={activity} />)}
                      </div>
                    </section>
                  ) : null}
                  {completed.length > 0 ? (
                    <details className="subagent-group subagent-group-collapsible">
                      {/* 「完成」栏目默认折叠，避免完成的活动条目占满面板；点击标题展开。 */}
                      <summary>
                        完成
                        <span className="subagent-group-count">{completed.length}</span>
                      </summary>
                      <div className="subagent-activities">
                        {completed.map((activity) => <SubagentActivityItem key={activity.id} activity={activity} />)}
                      </div>
                    </details>
                  ) : null}
                </>
              );
            })()}
            <h3>可用子代理</h3>
            {agentsLoading ? <p className="tree-status">正在读取…</p> : null}
            {agentsError ? <p className="tree-status error">{agentsError}</p> : null}
            {!agentsLoading && !agentsError && agents.length === 0 ? <p className="tree-status">未发现 agent 定义（~/.pi/agent/agents/*.md）。</p> : null}
            <div className="agent-descriptors">
              {agents.map((agent) => <AgentDescriptorItem key={`${agent.source}:${agent.name}`} agent={agent} />)}
            </div>
          </section>
        ) : null}
      </div>
      <footer>固定工作区 · 禁用 Shell</footer>
    </aside>
  );
}
