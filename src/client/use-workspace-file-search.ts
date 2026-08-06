"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiErrorResponse } from "@/contracts";
import type { WorkspaceContentMatch, WorkspaceContentSearchResponse, WorkspaceFileSearchResponse } from "@/workspace-contracts";

function errorMessage(payload: unknown) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || "无法搜索工作区文件。";
}

export type WorkspaceSearchMode = "name" | "content";

export type WorkspaceSearchOptions = { caseSensitive?: boolean; regex?: boolean };

export function useWorkspaceFileSearch(query: string, projectId: string | null, mode: WorkspaceSearchMode = "name", options: WorkspaceSearchOptions = {}) {
  const [result, setResult] = useState<WorkspaceFileSearchResponse | null>(null);
  const [contentResult, setContentResult] = useState<WorkspaceContentSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    if (!query.trim()) return;
    const timeout = window.setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError("");
      void (async () => {
        try {
          const params = new URLSearchParams({ query });
          if (projectId) params.set("projectId", projectId);
          let url = "/api/workspace/files";
          if (mode === "content") {
            url = "/api/workspace/search";
            if (options.caseSensitive) params.set("caseSensitive", "true");
            if (options.regex) params.set("regex", "true");
          }
          const response = await fetch(`${url}?${params.toString()}`, { cache: "no-store", signal: controller.signal });
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error(errorMessage(payload));
          if (!payload || typeof payload !== "object" || !("query" in payload) || !("truncated" in payload)) {
            throw new Error("文件搜索返回格式无效。");
          }
          if (controller.signal.aborted || controllerRef.current !== controller) return;
          if (mode === "content") {
            if (!("matches" in payload) || !Array.isArray((payload as { matches: unknown }).matches)) throw new Error("内容搜索返回格式无效。");
            setContentResult(payload as WorkspaceContentSearchResponse);
            setResult(null);
          } else {
            if (!("matches" in payload) || !Array.isArray((payload as { matches: unknown }).matches)) throw new Error("文件搜索返回格式无效。");
            setResult(payload as WorkspaceFileSearchResponse);
            setContentResult(null);
          }
        } catch (caught) {
          if (!controller.signal.aborted && controllerRef.current === controller) {
            setResult(null);
            setContentResult(null);
            setError(caught instanceof Error ? caught.message : "无法搜索工作区文件。");
          }
        } finally {
          if (controllerRef.current === controller) setLoading(false);
        }
      })();
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controllerRef.current?.abort();
    };
  }, [mode, options.caseSensitive, options.regex, projectId, query]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const hasQuery = Boolean(query.trim());
  const hasCurrentResult = hasQuery && (mode === "content" ? contentResult?.query === query : result?.query === query);
  return {
    matches: hasCurrentResult && mode === "name" ? result?.matches ?? [] : [],
    contentMatches: hasCurrentResult && mode === "content" ? (contentResult?.matches ?? []) as WorkspaceContentMatch[] : [],
    truncated: hasCurrentResult ? (mode === "content" ? contentResult?.truncated : result?.truncated) ?? false : false,
    loading: hasQuery && loading,
    error: hasQuery ? error : "",
  };
}
