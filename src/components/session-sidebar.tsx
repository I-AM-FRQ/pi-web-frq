"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, SessionSummary } from "@/contracts";

const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

type SessionSidebarProps = {
  sessions: SessionSummary[];
  projects: Project[];
  sessionProjectIds: Record<string, string>;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  seenSessionIds: ReadonlySet<string>;
  completedSessionIds: ReadonlySet<string>;
  runningSessionIds: ReadonlySet<string>;
  isLoading: boolean;
  onNewSession: (projectId: string | null) => void;
  onSelectSession: (sessionId: string) => void;
  onSelectProject: (projectId: string | null) => void;
  onCreateProject: (name: string, workspacePath?: string) => Promise<Project | null>;
  onRenameProject: (projectId: string, name: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, name: string) => Promise<boolean>;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
};

function titleFor(session: SessionSummary) {
  return session.name?.trim() || session.firstMessage.trim() || "未命名会话";
}

function timeFor(session: SessionSummary) {
  const elapsed = Date.now() - new Date(session.updatedAt).getTime();
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(session.updatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function Chevron({ open }: { open: boolean }) {
  return <svg className={open ? "chevron open" : "chevron"} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
}

function SessionRow({ session, selected, running, completed, onSelect, onRename, onDelete }: {
  session: SessionSummary;
  selected: boolean;
  running: boolean;
  completed: boolean;
  onSelect: () => void;
  onRename: (sessionId: string, name: string) => Promise<boolean>;
  onDelete: (sessionId: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(titleFor(session));
  const [saving, setSaving] = useState(false);
  const title = titleFor(session);
  const save = async () => {
    const nextName = draftName.trim();
    if (!nextName || saving) return;
    setSaving(true);
    if (await onRename(session.id, nextName)) setEditing(false);
    setSaving(false);
  };

  return (
    <li className={`project-session ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}>
      {editing ? <form className="session-row-name-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input autoFocus maxLength={120} value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={saving} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDraftName(title); setEditing(false); } }} onBlur={(event) => { if (!saving && !(event.relatedTarget instanceof HTMLElement && event.currentTarget.form?.contains(event.relatedTarget))) { setDraftName(title); setEditing(false); } }} aria-label="会话名称" />
        <button className="session-row-confirm" type="submit" disabled={saving || !draftName.trim()} aria-label="保存会话名称" title="保存">✓</button>
      </form> : <div className="project-session-row">
        <button type="button" className="project-session-select" onClick={onSelect} aria-current={selected ? "page" : undefined} title={title}>
          <span className="session-title">{title}</span>{running ? <span className="session-running" role="status" aria-label="正在执行" title="正在执行"><i aria-hidden="true" /></span> : <>{completed ? <span className="session-completed" role="status" aria-label="执行已完成" title="执行已完成" /> : null}<time dateTime={session.updatedAt}>{timeFor(session)}</time></>} 
        </button>
        <span className="session-row-actions">
          <button type="button" onClick={() => { setDraftName(title); setEditing(true); }} disabled={running} aria-label={`重命名会话 ${title}`} title="重命名">✎</button>
          <button type="button" onClick={() => { if (window.confirm("删除此会话及其本地历史？此操作无法撤销。")) void onDelete(session.id); }} disabled={running} aria-label={`删除会话 ${title}`} title="删除">×</button>
        </span>
      </div>}
    </li>
  );
}

function ProjectGroup({ project, sessions, selectedSessionId, selectedProjectId, seenSessionIds, completedSessionIds = EMPTY_SESSION_IDS, runningSessionIds = EMPTY_SESSION_IDS, onNewSession, onSelectProject, onSelectSession, onRename, onDelete, onRenameSession, onDeleteSession }: {
  project: Project;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  selectedProjectId: string | null;
  seenSessionIds: ReadonlySet<string>;
  completedSessionIds: ReadonlySet<string>;
  runningSessionIds: ReadonlySet<string>;
  onNewSession: (projectId: string | null) => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectSession: (sessionId: string) => void;
  onRename: (projectId: string, name: string) => Promise<boolean>;
  onDelete: (projectId: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, name: string) => Promise<boolean>;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const isSelected = selectedProjectId === project.id;
  const unreadCompleted = sessions.filter((session) => session.completed && !seenSessionIds.has(session.id)).length;
  const hasRunning = sessions.some((session) => runningSessionIds.has(session.id));
  const rename = async () => { if (await onRename(project.id, draftName)) setEditing(false); };
  return (
    <section className={`project-group ${isSelected ? "selected" : ""}`}>
      <div className="project-row" onClick={() => { if (!editing) onSelectProject(project.id); }}>
        <button type="button" className="project-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? "折叠" : "展开"}项目 ${project.name}`}><Chevron open={expanded} /></button>
        {editing ? <form className="project-name-form" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void rename(); }}><input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus maxLength={80} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDraftName(project.name); setEditing(false); } }} onBlur={(event) => { if (!(event.relatedTarget instanceof HTMLElement && event.currentTarget.form?.contains(event.relatedTarget))) setEditing(false); }} aria-label="项目名称" /><button className="confirm-button" type="submit" disabled={!draftName.trim()} aria-label="保存项目名称" title="保存"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg></button></form> : <button type="button" className="project-name" title={project.name}>{project.name}</button>}
        {unreadCompleted > 0 ? <span className="project-count" title={`${unreadCompleted} 个会话有新的完成结果`}>{unreadCompleted}</span> : null}
        <div className="project-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onNewSession(project.id); }} aria-label={`在项目 ${project.name} 中新建会话`} title="新建会话">＋</button><button type="button" onClick={(event) => { event.stopPropagation(); setDraftName(project.name); setEditing(true); }} disabled={hasRunning} aria-label={`重命名项目 ${project.name}`} title="重命名">✎</button><button type="button" onClick={(event) => { event.stopPropagation(); if (window.confirm(`删除项目“${project.name}”？请先删除项目内的会话。`)) void onDelete(project.id); }} disabled={hasRunning} aria-label={`删除项目 ${project.name}`} title="删除">×</button></div>
      </div>
      {expanded ? <ul className="project-sessions">{sessions.map((session) => <SessionRow key={session.id} session={session} selected={selectedSessionId === session.id} running={runningSessionIds.has(session.id)} completed={completedSessionIds.has(session.id)} onSelect={() => onSelectSession(session.id)} onRename={onRenameSession} onDelete={onDeleteSession} />)}{sessions.length === 0 ? <li className="project-empty">暂无会话</li> : null}</ul> : null}
    </section>
  );
}

export function SessionSidebar(props: SessionSidebarProps) {
  const completedSessionIds = props.completedSessionIds ?? EMPTY_SESSION_IDS;
  const runningSessionIds = props.runningSessionIds ?? EMPTY_SESSION_IDS;
  const [showMenu, setShowMenu] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectWorkspace, setNewProjectWorkspace] = useState("");
  const projectCreateRef = useRef<HTMLDivElement>(null);
  const ungrouped = useMemo(() => props.sessions.filter((session) => !props.sessionProjectIds[session.id]), [props.sessions, props.sessionProjectIds]);
  const ungroupedUnread = ungrouped.filter((session) => session.completed && !props.seenSessionIds.has(session.id)).length;
  const sessionsFor = (projectId: string) => props.sessions.filter((session) => props.sessionProjectIds[session.id] === projectId);
  const createProject = async () => {
    const project = await props.onCreateProject(newProjectName, newProjectWorkspace);
    if (project) { setNewProjectName(""); setNewProjectWorkspace(""); setShowMenu(false); }
  };

  useEffect(() => {
    if (!showMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!projectCreateRef.current?.contains(event.target as Node)) setShowMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMenu(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showMenu]);

  return <section className="session-sidebar" aria-label="项目与会话">
    <div className="project-create-area" ref={projectCreateRef}><div className="project-heading"><h2 className="sidebar-section-title">项目</h2><div className="project-heading-actions"><button type="button" onClick={() => setShowMenu(true)} aria-label="新建项目" title="新建项目"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button></div></div>
    {showMenu ? <form className="new-project-form" onSubmit={(event) => { event.preventDefault(); void createProject(); }}><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="项目名称" maxLength={80} autoFocus /><input value={newProjectWorkspace} onChange={(event) => setNewProjectWorkspace(event.target.value)} placeholder="工作区路径（留空默认：文档/Pi/项目名）" /><button type="submit" disabled={!newProjectName.trim()}>创建</button></form> : null}</div>
    <nav className="project-list" aria-label="项目与会话列表">
      {props.isLoading ? <p className="empty-sessions">加载中…</p> : null}
      {props.projects.map((project) => <ProjectGroup key={project.id} project={project} sessions={sessionsFor(project.id)} selectedSessionId={props.selectedSessionId} selectedProjectId={props.selectedProjectId} seenSessionIds={props.seenSessionIds} completedSessionIds={completedSessionIds} runningSessionIds={runningSessionIds} onNewSession={props.onNewSession} onSelectProject={props.onSelectProject} onSelectSession={(sessionId) => { props.onSelectProject(project.id); props.onSelectSession(sessionId); }} onRename={props.onRenameProject} onDelete={props.onDeleteProject} onRenameSession={props.onRenameSession} onDeleteSession={props.onDeleteSession} />)}
      <section className={`project-group ungrouped ${props.selectedProjectId === null ? "selected" : ""}`}><div className="project-row" role="button" tabIndex={0} onClick={() => props.onNewSession(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onNewSession(null); } }} aria-label="在无项目中新建会话"><span className="project-toggle-spacer" aria-hidden="true" /><span className="project-name">无项目</span>{ungroupedUnread > 0 ? <span className="project-count" title={`${ungroupedUnread} 个会话有新的完成结果`}>{ungroupedUnread}</span> : null}</div><ul className="project-sessions">{ungrouped.map((session) => <SessionRow key={session.id} session={session} selected={props.selectedSessionId === session.id} running={runningSessionIds.has(session.id)} completed={completedSessionIds.has(session.id)} onSelect={() => { props.onSelectProject(null); props.onSelectSession(session.id); }} onRename={props.onRenameSession} onDelete={props.onDeleteSession} />)}</ul></section>
    </nav>
  </section>;
}
