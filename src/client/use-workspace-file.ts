"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorResponse } from "@/contracts";
import type { WorkspaceFilePreview } from "@/workspace-contracts";

function errorMessage(payload: unknown) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || "无法读取文件预览。";
}

export function useWorkspaceFile(projectId: string | null) {
  const [file, setFile] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const loadFile = useCallback(async (path: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    setFile(null);

    try {
      const response = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      if (!payload || typeof payload !== "object" || !("path" in payload) || !("content" in payload) || !("totalLines" in payload)) {
        throw new Error("文件预览返回格式无效。");
      }
      if (!controller.signal.aborted && controllerRef.current === controller) setFile(payload as WorkspaceFilePreview);
    } catch (caught) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        setError(caught instanceof Error ? caught.message : "无法读取文件预览。");
      }
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setFile(null);
    setLoading(false);
    setError("");
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { file, loading, error, loadFile, clear };
}
