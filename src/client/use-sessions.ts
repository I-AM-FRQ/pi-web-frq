"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorResponse, Project, SessionDetail, SessionSummary } from "@/contracts";

function errorMessage(payload: unknown, fallback: string) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || fallback;
}

function projectMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([sessionId, projectId]) => typeof sessionId === "string" && typeof projectId === "string"));
}

const SEEN_SESSIONS_KEY = "pi-workbench-seen-sessions";

function loadSeenSessions(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_SESSIONS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function persistSeenSessions(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_SESSIONS_KEY, JSON.stringify([...ids]));
  } catch {
    // 隐私模式下忽略持久化失败
  }
}

const SELECTED_KEY = "pi-workbench-selected-session";

type SelectedState = { projectId: string | null; sessionId: string | null };

function loadSelected(): SelectedState {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return { projectId: null, sessionId: null };
    const parsed = JSON.parse(raw) as { projectId?: unknown; sessionId?: unknown };
    return {
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
    };
  } catch {
    return { projectId: null, sessionId: null };
  }
}

function persistSelected(state: SelectedState) {
  try {
    if (state.sessionId) {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(SELECTED_KEY);
    }
  } catch {
    // 隐私模式下忽略持久化失败
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionProjectIds, setSessionProjectIds] = useState<Record<string, string>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [seenSessionIds, setSeenSessionIds] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoadingEarlierConversation, setIsLoadingEarlierConversation] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const listControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const hasLoadedListRef = useRef(false);

  const markSessionSeen = useCallback((sessionId: string) => {
    setSeenSessionIds((current) => {
      if (current.has(sessionId)) return current;
      const next = new Set(current);
      next.add(sessionId);
      persistSeenSessions(next);
      return next;
    });
  }, []);

  const loadDetail = useCallback(async (sessionId: string, entryId?: string, keepCurrentDetail = false, includeTree = false) => {
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    setIsLoadingDetail(true);
    if (!keepCurrentDetail) setDetail(null);
    setError("");
    try {
      const parameters = new URLSearchParams();
      if (entryId) parameters.set("entryId", entryId);
      if (includeTree) parameters.set("includeTree", "true");
      const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${query}`, { cache: "no-store", signal: controller.signal });
      window.clearTimeout(timeout);
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法加载会话（HTTP ${response.status}）。`));
      if (!payload || typeof payload !== "object" || !("session" in payload) || !("activeLeafId" in payload) || !("previewEntryId" in payload) || !("conversation" in payload) || !("tree" in payload) || !("usage" in payload) || !("context" in payload) || !("conversationNextOffset" in payload) || !("truncated" in payload) || !("treeLoaded" in payload)) throw new Error("会话返回格式无效。");
      if (!controller.signal.aborted && detailControllerRef.current === controller) setDetail(payload as SessionDetail);
    } catch (caught) {
      if (detailControllerRef.current === controller) setError(controller.signal.aborted ? "会话加载超时，请选择其他会话或稍后重试。" : caught instanceof Error ? caught.message : "无法加载会话。");
    } finally {
      if (detailControllerRef.current === controller) {
        detailControllerRef.current = null;
        setIsLoadingDetail(false);
      }
    }
  }, []);

  const selectSession = useCallback((sessionId: string | null, options?: { loadDetail?: boolean }) => {
    if (selectedSessionIdRef.current === sessionId) return;
    selectedSessionIdRef.current = sessionId;
    detailControllerRef.current?.abort();
    setSelectedSessionId(sessionId);
    setDetail(null);
    setError("");
    persistSelected({ projectId: selectedProjectIdRef.current, sessionId });
    if (sessionId) {
      markSessionSeen(sessionId);
      if (options?.loadDetail !== false) void loadDetail(sessionId);
    }
  }, [loadDetail, markSessionSeen]);

  const refreshSessions = useCallback(async (selectMostRecent = false) => {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    // 仅首次加载显示“加载中…”，后续刷新保留现有列表静默更新，避免完成时项目列表闪动。
    if (!hasLoadedListRef.current) setIsLoading(true);
    try {
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch("/api/sessions", { cache: "no-store", signal: controller.signal });
      window.clearTimeout(timeout);
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法加载历史会话（HTTP ${response.status}）。`));
      const data = payload as { sessions?: unknown; projects?: unknown; sessionProjectIds?: unknown };
      if (!Array.isArray(data.sessions) || !Array.isArray(data.projects)) throw new Error("历史会话返回格式无效。");
      if (!controller.signal.aborted && listControllerRef.current === controller) {
        const sortedSessions = [...data.sessions as SessionSummary[]].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const sortedProjects = [...data.projects as Project[]].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const nextSessionProjectIds = projectMap(data.sessionProjectIds);
        setSessions(sortedSessions);
        setProjects(sortedProjects);
        setSessionProjectIds(nextSessionProjectIds);
        if (selectedSessionIdRef.current) {
          const projectId = nextSessionProjectIds[selectedSessionIdRef.current] ?? null;
          selectedProjectIdRef.current = projectId;
          setSelectedProjectId(projectId);
          persistSelected({ projectId, sessionId: selectedSessionIdRef.current });
        } else {
          setSelectedProjectId((current) => {
            const projectId = current && sortedProjects.some((project) => project.id === current) ? current : null;
            selectedProjectIdRef.current = projectId;
            return projectId;
          });
        }
        setError("");
        hasLoadedListRef.current = true;
        if (selectMostRecent && selectedSessionIdRef.current === null) {
          const nextId = sortedSessions[0]?.id ?? null;
          selectedSessionIdRef.current = nextId;
          setSelectedSessionId(nextId);
          setDetail(null);
          if (nextId) void loadDetail(nextId);
        }
      }
    } catch (caught) {
      if (listControllerRef.current === controller) setError(controller.signal.aborted ? "历史会话加载超时，请稍后重试。" : caught instanceof Error ? caught.message : "无法加载历史会话。");
    } finally {
      if (listControllerRef.current === controller) {
        listControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [loadDetail]);

  const selectProject = useCallback((projectId: string | null) => {
    if (selectedProjectIdRef.current !== projectId) selectSession(null);
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    persistSelected({ projectId, sessionId: selectedSessionIdRef.current });
  }, [selectSession]);

  const createSession = useCallback((projectId: string | null = selectedProjectIdRef.current) => {
    selectSession(null);
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    persistSelected({ projectId, sessionId: null });
  }, [selectSession]);

  const adoptSession = useCallback((sessionId: string, projectId?: string | null) => {
    const shouldSelect = selectedSessionIdRef.current === null || selectedSessionIdRef.current === sessionId;
    if (projectId !== undefined) setSessionProjectIds((current) => projectId ? { ...current, [sessionId]: projectId } : current);
    if (shouldSelect) {
      selectedSessionIdRef.current = sessionId;
      setSelectedSessionId(sessionId);
      markSessionSeen(sessionId);
      if (projectId !== undefined) {
        selectedProjectIdRef.current = projectId;
        setSelectedProjectId(projectId);
      }
      persistSelected({ projectId: projectId ?? selectedProjectIdRef.current, sessionId });
      setDetail((current) => current?.session.id === sessionId ? current : null);
    }
    setError("");
  }, [markSessionSeen]);

  const refreshDetail = useCallback((sessionId: string, entryId?: string) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    void loadDetail(sessionId, entryId);
  }, [loadDetail]);

  const refreshCurrentDetail = useCallback((sessionId: string): Promise<void> => {
    // keepCurrentDetail 保留现有内容，避免任务完成时对话区先清空再回填导致闪烁。
    if (selectedSessionIdRef.current === sessionId) return loadDetail(sessionId, undefined, true);
    return Promise.resolve();
  }, [loadDetail]);

  const previewSessionBranch = useCallback((sessionId: string, entryId: string) => {
    if (selectedSessionIdRef.current === sessionId) void loadDetail(sessionId, entryId, true);
  }, [loadDetail]);

  const loadEarlierConversation = useCallback(async (): Promise<boolean> => {
    const current = detail;
    const sessionId = selectedSessionIdRef.current;
    if (!current || !sessionId || current.session.id !== sessionId || current.conversationNextOffset === null || isLoadingEarlierConversation) return false;
    setIsLoadingEarlierConversation(true);
    try {
      const parameters = new URLSearchParams({ conversationOffset: String(current.conversationNextOffset) });
      if (current.previewEntryId) parameters.set("entryId", current.previewEntryId);
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?${parameters.toString()}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("conversation" in payload) || !("conversationNextOffset" in payload)) throw new Error(errorMessage(payload, "无法加载更早消息。"));
      const page = payload as SessionDetail;
      if (selectedSessionIdRef.current !== sessionId) return false;
      setDetail((latest) => latest?.session.id === sessionId ? { ...latest, conversation: [...page.conversation, ...latest.conversation], conversationNextOffset: page.conversationNextOffset, truncated: { ...latest.truncated, conversation: page.conversationNextOffset !== null } } : latest);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法加载更早消息。");
      return false;
    } finally {
      setIsLoadingEarlierConversation(false);
    }
  }, [detail, isLoadingEarlierConversation]);

  const loadSessionTree = useCallback(() => {
    if (!selectedSessionIdRef.current || detail?.treeLoaded) return;
    void loadDetail(selectedSessionIdRef.current, detail?.previewEntryId ?? undefined, true, true);
  }, [detail?.previewEntryId, detail?.treeLoaded, loadDetail]);

  const createProject = useCallback(async (name: string, workspacePath?: string): Promise<Project | null> => {
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...(workspacePath?.trim() ? { workspacePath: workspacePath.trim() } : {}) }) });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("project" in payload)) throw new Error(errorMessage(payload, "无法创建项目。"));
      const project = (payload as { project: Project }).project;
      setProjects((current) => [project, ...current]);
      setSelectedProjectId(project.id);
      setError("");
      return project;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法创建项目。");
      return null;
    }
  }, []);

  const renameProject = useCallback(async (projectId: string, name: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("project" in payload)) throw new Error(errorMessage(payload, "无法重命名项目。"));
      const project = (payload as { project: Project }).project;
      setProjects((current) => current.map((item) => item.id === projectId ? project : item));
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法重命名项目。");
      return false;
    }
  }, []);

  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(errorMessage(await response.json(), "无法删除项目。"));
      setProjects((current) => current.filter((item) => item.id !== projectId));
      setSessionProjectIds((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value !== projectId)));
      if (selectedProjectIdRef.current === projectId) selectedProjectIdRef.current = null;
      setSelectedProjectId((current) => current === projectId ? null : current);
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法删除项目。");
      return false;
    }
  }, []);

  const moveSession = useCallback(async (sessionId: string, projectId: string | null): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/project`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      if (!response.ok) throw new Error(errorMessage(await response.json(), "无法移动会话。"));
      setSessionProjectIds((current) => {
        const next = { ...current };
        if (projectId) next[sessionId] = projectId;
        else delete next[sessionId];
        return next;
      });
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法移动会话。");
      return false;
    }
  }, []);

  const forkSession = useCallback(async (sessionId: string, entryId?: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, { method: "POST", ...(entryId ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId }) } : {}) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法复制会话（HTTP ${response.status}）。`));
      if (!payload || typeof payload !== "object" || !("session" in payload)) throw new Error("会话返回格式无效。");
      const session = payload.session as SessionSummary;
      const projectId = sessionProjectIds[sessionId] ?? null;
      setSessions((current) => [session, ...current]);
      if (projectId) setSessionProjectIds((current) => ({ ...current, [session.id]: projectId }));
      selectedSessionIdRef.current = session.id;
      setSelectedSessionId(session.id);
      void loadDetail(session.id);
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法复制会话。");
      return false;
    }
  }, [loadDetail, sessionProjectIds]);

  const exportSession = useCallback(async (sessionId: string, entryId?: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entryId ? { entryId } : {}) });
      if (!response.ok) throw new Error(errorMessage(await response.json(), `无法导出会话（HTTP ${response.status}）。`));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "workbench-session.txt";
      anchor.click();
      URL.revokeObjectURL(url);
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法导出会话。");
      return false;
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(errorMessage(await response.json(), `无法删除会话（HTTP ${response.status}）。`));
      setSessions((current) => current.filter((item) => item.id !== sessionId));
      setSessionProjectIds((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)));
      if (selectedSessionIdRef.current === sessionId) {
        selectedSessionIdRef.current = null;
        setSelectedSessionId(null);
        setDetail(null);
      }
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法删除会话。");
      return false;
    }
  }, []);

  const renameSession = useCallback(async (sessionId: string, name: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法重命名会话（HTTP ${response.status}）。`));
      if (!payload || typeof payload !== "object" || !("session" in payload)) throw new Error("会话返回格式无效。");
      const session = payload.session as SessionSummary;
      setSessions((current) => current.map((item) => item.id === sessionId ? session : item));
      setDetail((current) => current?.session.id === sessionId ? { ...current, session } : current);
      setError("");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法重命名会话。");
      return false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setSeenSessionIds(loadSeenSessions()); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 恢复上次刷新的选中会话与项目。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const selected = loadSelected();
      if (!selected.sessionId) return;
      selectedProjectIdRef.current = selected.projectId;
      selectedSessionIdRef.current = selected.sessionId;
      setSelectedProjectId(selected.projectId);
      setSelectedSessionId(selected.sessionId);
      markSessionSeen(selected.sessionId);
      void loadDetail(selected.sessionId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, markSessionSeen]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshSessions(false); }, 0);
    return () => {
      window.clearTimeout(timer);
      listControllerRef.current?.abort();
      detailControllerRef.current?.abort();
    };
  }, [refreshSessions]);

  return {
    sessions, projects, sessionProjectIds, selectedProjectId, selectedSessionId, detail, isLoading, isLoadingDetail, isLoadingEarlierConversation, error,
    refreshSessions, selectSession, selectProject, createSession, adoptSession, refreshDetail, refreshCurrentDetail, previewSessionBranch, loadEarlierConversation, loadSessionTree, markSessionSeen, seenSessionIds,
    createProject, renameProject, deleteProject, moveSession, renameSession, exportSession, deleteSession, forkSession,
  };
}
