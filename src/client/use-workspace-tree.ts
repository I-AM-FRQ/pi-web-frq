"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorResponse } from "@/contracts";
import type { WorkspaceResponse } from "@/workspace-contracts";

export type WorkspaceNode = WorkspaceResponse & { error?: string; loading?: boolean };

function errorMessage(payload: unknown) {
  const error = payload as ApiErrorResponse;
  return error?.error?.message || "无法读取工作区目录。";
}

export function useWorkspaceTree(projectId: string | null) {
  const [nodes, setNodes] = useState<Record<string, WorkspaceNode>>({});
  const controllersRef = useRef(new Map<string, AbortController>());

  const loadPath = useCallback(async (path: string) => {
    if (controllersRef.current.has(path)) return;
    const controller = new AbortController();
    controllersRef.current.set(path, controller);
    setNodes((current) => ({
      ...current,
      [path]: { ...(current[path] ?? { path, entries: [], capabilities: undefined }), loading: true },
    }));

    try {
      const response = await fetch(`/api/workspace?path=${encodeURIComponent(path)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      if (!payload || typeof payload !== "object" || !("path" in payload) || !("entries" in payload) || !("capabilities" in payload)) {
        throw new Error("工作区返回格式无效。");
      }
      if (!controller.signal.aborted && controllersRef.current.get(path) === controller) {
        setNodes((current) => ({ ...current, [path]: { ...(payload as WorkspaceResponse), loading: false } }));
      }
    } catch (caught) {
      if (!controller.signal.aborted && controllersRef.current.get(path) === controller) {
        setNodes((current) => ({
          ...current,
          [path]: {
            ...(current[path] ?? { path, entries: [], capabilities: undefined }),
            loading: false,
            error: caught instanceof Error ? caught.message : "无法读取工作区目录。",
          },
        }));
      }
    } finally {
      if (controllersRef.current.get(path) === controller) controllersRef.current.delete(path);
    }
  }, [projectId]);

  useEffect(() => {
    const controllers = controllersRef.current;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    setNodes({});
    void loadPath(".");
    return () => controllers.forEach((controller) => controller.abort());
  }, [loadPath, projectId]);

  return { nodes, loadPath };
}
