"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatRun } from "@/client/use-chat-stream";
import type { AgentDescriptor, SessionDetail, SubagentActivity } from "@/contracts";

/**
 * 汇总 subagent 运行活动：实时（chat runs 中的工具条目）+ 历史（会话详情中的 tool 条目）。
 * 按工具调用 id 去重，实时条目优先、最新在前。
 */
export function useSubagentActivity(runs: ChatRun[], detail: SessionDetail | null, projectId: string | null) {
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState("");
  const requestedProjectRef = useRef<string | null | undefined>(undefined);

  const loadAgents = useCallback(async (targetProjectId: string | null) => {
    setAgentsLoading(true);
    setAgentsError("");
    try {
      const params = new URLSearchParams();
      if (targetProjectId) params.set("projectId", targetProjectId);
      const response = await fetch(`/api/agents?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      const list = (typeof payload === "object" && payload !== null && "agents" in payload ? payload.agents : null) as AgentDescriptor[] | null;
      if (!Array.isArray(list)) throw new Error("响应格式错误");
      setAgents(list);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "无法加载子代理列表");
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (requestedProjectRef.current === projectId) return;
    requestedProjectRef.current = projectId;
    void loadAgents(projectId);
  }, [projectId, loadAgents]);

  const live = useMemo<SubagentActivity[]>(() => {
    const activities: SubagentActivity[] = [];
    const seen = new Set<string>();
    for (const run of runs) {
      for (const tool of run.tools) {
        if (tool.name !== "subagent" || !tool.details || seen.has(tool.id)) continue;
        seen.add(tool.id);
        activities.push({ id: tool.id, label: tool.label, result: tool.result, isError: tool.isError, running: tool.running, details: tool.details, sessionId: run.sessionId });
      }
    }
    return activities;
  }, [runs]);

  const historical = useMemo<SubagentActivity[]>(() => {
    if (!detail) return [];
    const activities: SubagentActivity[] = [];
    for (const item of detail.conversation) {
      if (item.type !== "tool" || item.name !== "subagent" || !item.details) continue;
      activities.push({ id: item.id ?? `hist-${activities.length}`, label: item.label, result: item.result, isError: item.isError, running: false, details: item.details, sessionId: detail.session.id });
    }
    return activities;
  }, [detail]);

  // 实时优先；历史按出现顺序保留（前端已按时间排列）。
  const merged = useMemo(() => {
    const liveIds = new Set(live.map((activity) => activity.id));
    return [...live, ...historical.filter((activity) => !liveIds.has(activity.id))];
  }, [live, historical]);

  return { activities: merged, agents, agentsLoading, agentsError, reloadAgents: () => loadAgents(null) };
}
