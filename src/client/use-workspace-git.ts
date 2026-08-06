"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorResponse } from "@/contracts";
import type { WorkspaceGitAction, WorkspaceGitBranches, WorkspaceGitCommit, WorkspaceGitDiff, WorkspaceGitDiffMode, WorkspaceGitStatus } from "@/workspace-contracts";

export type WorkspaceGitState = {
  status: WorkspaceGitStatus | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  diff: WorkspaceGitDiff | null;
  diffLoading: boolean;
  diffError: string;
  openDiff: (path: string, mode: WorkspaceGitDiffMode) => Promise<void>;
  closeDiff: () => void;
  branches: WorkspaceGitBranches | null;
  commits: WorkspaceGitCommit[];
  actionLoading: boolean;
  actionError: string;
  runAction: (action: WorkspaceGitAction) => Promise<boolean>;
  loadBranches: () => Promise<void>;
  loadCommits: () => Promise<void>;
};

function errorMessage(payload: unknown, fallback: string) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || fallback;
}

export function useWorkspaceGit(projectId: string | null) {
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<WorkspaceGitDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [branches, setBranches] = useState<WorkspaceGitBranches | null>(null);
  const [commits, setCommits] = useState<WorkspaceGitCommit[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const statusControllerRef = useRef<AbortController | null>(null);
  const diffControllerRef = useRef<AbortController | null>(null);

  const gitUrl = useCallback((view = "") => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (view) params.set("view", view);
    const query = params.toString();
    return `/api/workspace/git${query ? `?${query}` : ""}`;
  }, [projectId]);

  const refresh = useCallback(async () => {
    statusControllerRef.current?.abort();
    const controller = new AbortController();
    statusControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(gitUrl(), { cache: "no-store", signal: controller.signal });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法读取 Git 状态（HTTP ${response.status}）。`));
      if (!payload || typeof payload !== "object" || !("available" in payload) || !("entries" in payload)) {
        throw new Error("Git 状态返回格式无效。");
      }
      if (!controller.signal.aborted && statusControllerRef.current === controller) setStatus(payload as WorkspaceGitStatus);
    } catch (caught) {
      if (!controller.signal.aborted && statusControllerRef.current === controller) setError(caught instanceof Error ? caught.message : "无法读取 Git 状态。");
    } finally {
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
        setLoading(false);
      }
    }
  }, [gitUrl]);

  const openDiff = useCallback(async (path: string, mode: WorkspaceGitDiffMode) => {
    diffControllerRef.current?.abort();
    const controller = new AbortController();
    diffControllerRef.current = controller;
    setDiff(null);
    setDiffError("");
    setDiffLoading(true);
    try {
      const params = new URLSearchParams({ path, mode });
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/workspace/git/diff?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, `无法读取差异（HTTP ${response.status}）。`));
      if (!payload || typeof payload !== "object" || !("path" in payload) || !("content" in payload)) {
        throw new Error("Git 差异返回格式无效。");
      }
      if (!controller.signal.aborted && diffControllerRef.current === controller) setDiff(payload as WorkspaceGitDiff);
    } catch (caught) {
      if (!controller.signal.aborted && diffControllerRef.current === controller) setDiffError(caught instanceof Error ? caught.message : "无法读取差异。");
    } finally {
      if (diffControllerRef.current === controller) {
        diffControllerRef.current = null;
        setDiffLoading(false);
      }
    }
  }, [projectId]);

  const closeDiff = useCallback(() => {
    diffControllerRef.current?.abort();
    setDiff(null);
    setDiffError("");
    setDiffLoading(false);
  }, []);

  const loadBranches = useCallback(async () => {
    const controller = new AbortController();
    try {
      const response = await fetch(gitUrl("branches"), { cache: "no-store", signal: controller.signal });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "无法读取 Git 分支。"));
      if (!controller.signal.aborted) setBranches(payload as WorkspaceGitBranches);
    } catch {
      // 分支信息失败不阻塞主面板
    }
  }, [gitUrl]);

  const loadCommits = useCallback(async () => {
    const controller = new AbortController();
    try {
      const response = await fetch(gitUrl("log"), { cache: "no-store", signal: controller.signal });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "无法读取 Git 日志。"));
      if (!controller.signal.aborted && Array.isArray(payload)) setCommits(payload as WorkspaceGitCommit[]);
    } catch {
      // 日志失败不阻塞主面板
    }
  }, [gitUrl]);

  const runAction = useCallback(async (action: WorkspaceGitAction): Promise<boolean> => {
    setActionLoading(true);
    setActionError("");
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      const query = params.toString();
      const response = await fetch(`/api/workspace/git${query ? `?${query}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Git 操作失败。"));
      await Promise.all([refresh(), loadBranches(), loadCommits()]);
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Git 操作失败。");
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [loadBranches, loadCommits, projectId, refresh]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void refresh(); void loadBranches(); void loadCommits(); }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      statusControllerRef.current?.abort();
      diffControllerRef.current?.abort();
    };
  }, [projectId, refresh, loadBranches, loadCommits]);

  return { status, loading, error, refresh, diff, diffLoading, diffError, openDiff, closeDiff, branches, commits, actionLoading, actionError, runAction, loadBranches, loadCommits } satisfies WorkspaceGitState;
}
