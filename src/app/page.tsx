"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStream } from "@/client/use-chat-stream";
import { useSubagentActivity } from "@/client/use-subagent-activity";
import { useCompletionNotifier } from "@/client/use-completion-notifier";
import { CompletionToast } from "@/components/completion-toast";
import { useSessions } from "@/client/use-sessions";
import { useWorkspaceTree } from "@/client/use-workspace-tree";
import { useWorkspaceGit } from "@/client/use-workspace-git";
import { ConversationView } from "@/components/conversation-view";
import { SessionSidebar } from "@/components/session-sidebar";
import { WorkbenchSidePanel } from "@/components/workbench-side-panel";
import { ChatComposer } from "@/components/chat-composer";
import { ChatHeader } from "@/components/chat-header";
import type { SlashCommand } from "@/components/slash-command-menu";
import { WorkspaceFilePreview } from "@/components/workspace-file-preview";
import { WorkspaceGitDiff } from "@/components/workspace-git-diff";
import { ProviderConfigModal } from "@/components/provider-config-modal";
import { AgentResourcesModal } from "@/components/agent-resources-modal";
import { SystemPromptModal } from "@/components/system-prompt-modal";
import { GlobalSettingsModal } from "@/components/global-settings-modal";
import { insertFileReference } from "@/client/file-references";
import { useSettings } from "@/client/settings";
import { copyTextToClipboard } from "@/client/clipboard";
import type { AgentResources, ChatImage, ModelDescriptor, SessionContextSummary, ThinkingLevel } from "@/contracts";

type RunConfigTab = "skills" | "plugins";

const LAST_MODEL_KEY = "pi-web-frq-last-model";

const THINKING_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** 在模型支持的档位中取与请求档位最接近的一个（按强度顺序，取距离最近的）。 */
function nearestThinkingLevel(requested: ThinkingLevel, supported: ThinkingLevel[]): ThinkingLevel {
  if (supported.length === 0) return "off";
  if (supported.includes(requested)) return requested;
  const ri = THINKING_ORDER.indexOf(requested);
  let best = supported[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of supported) {
    const dist = Math.abs(THINKING_ORDER.indexOf(candidate) - ri);
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return best;
}

export default function Home() {
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [userTouchedModel, setUserTouchedModel] = useState(false);
  const [sessionThinkingLevels, setSessionThinkingLevels] = useState<Record<string, ThinkingLevel | "auto">>({});
  const [prompt, setPrompt] = useState("");
  const [commandNotice, setCommandNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [steerBehavior, setSteerBehavior] = useState<"steer" | "followUp">("steer");
  const [runConfigTab, setRunConfigTab] = useState<RunConfigTab | null>(null);
  const [providerConfigOpen, setProviderConfigOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [agentResources, setAgentResources] = useState<AgentResources | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLine, setPreviewLine] = useState<number | null>(null);
  const [branchFromEntryId, setBranchFromEntryId] = useState<string | undefined>();
  const [branchDetailReady, setBranchDetailReady] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<"sessions" | "workspace" | null>(null);
  const [panelsCollapsed, setPanelsCollapsed] = useState(() => {
    try {
      if (typeof window === "undefined") return { left: false, right: false };
      const raw = localStorage.getItem("pi-workbench-panels");
      if (!raw) return { left: false, right: false };
      const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown };
      return { left: parsed.left === true, right: parsed.right === true };
    } catch {
      return { left: false, right: false };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("pi-workbench-panels", JSON.stringify(panelsCollapsed));
    } catch {
      // 隐私模式等场景下忽略持久化失败
    }
  }, [panelsCollapsed]);
  const [rightWidth, setRightWidth] = useState(316);
  const [rightResizing, setRightResizing] = useState(false);
  const [completedSessionIds, setCompletedSessionIds] = useState<Set<string>>(() => new Set());
  const [liveContext, setLiveContext] = useState<{ sessionId: string; context: SessionContextSummary } | null>(null);
  const rightWidthRestoredRef = useRef(false);
  const selectedSessionIdRef = useRef<string | null>(null);
  const resumedSessionIdsRef = useRef<Set<string>>(new Set());
  const rightResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const modelLoadControllerRef = useRef<AbortController | null>(null);
  const commandNoticeTimerRef = useRef<number | null>(null);
  const chat = useChatStream();
  const sessions = useSessions();
  const { settings } = useSettings();
  const { toasts, dismissToast } = useCompletionNotifier(chat.runs, settings);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const selectedProjectId = sessions.selectedProjectId && sessions.projects.some((project) => project.id === sessions.selectedProjectId) ? sessions.selectedProjectId : null;
  const subagents = useSubagentActivity(chat.runs, sessions.detail, selectedProjectId);
  const workspace = useWorkspaceTree(selectedProjectId);
  const git = useWorkspaceGit(selectedProjectId);
  // 会话模型优先：用户未手动改过模型时，跟随当前会话记录的模型（刷新后保持一致）；
  // 用户手动选择后以手选为准；无会话模型时回退到已选值（含 localStorage 恢复）。
  const detailModelKey = (() => {
    const detailModel = sessions.detail?.context?.model;
    return detailModel ? `${detailModel.provider}:${detailModel.id}` : "";
  })();
  const effectiveModelKey = userTouchedModel ? modelKey : (detailModelKey || modelKey);
  const selectedModel = models.find((model) => `${model.provider}:${model.id}` === effectiveModelKey);
  const activeRun = chat.runFor(sessions.selectedSessionId);
  const isStreaming = activeRun?.isStreaming ?? false;
  const displayedContext = liveContext?.sessionId === sessions.selectedSessionId && isStreaming ? liveContext.context : sessions.detail?.context;
  const thinkingKey = sessions.selectedSessionId ?? `new:${selectedProjectId ?? "default"}`;
  const contextThinkingLevel = sessions.selectedSessionId && sessions.detail?.session.id === sessions.selectedSessionId && sessions.detail.context?.thinkingLevel;
  const requestedThinkingLevel: ThinkingLevel | "auto" = sessionThinkingLevels[thinkingKey] ?? (!sessions.selectedSessionId && settings.defaultThinkingLevel ? settings.defaultThinkingLevel : (contextThinkingLevel && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(contextThinkingLevel) ? contextThinkingLevel as ThinkingLevel : "auto"));
  const recommendedThinkingLevel = selectedModel?.thinkingLevels.includes("high") ? "high" : selectedModel?.thinkingLevels.find((level) => level !== "off") ?? "off";
  // 用户选择的档位（含模型不支持的）：提交时映射为支持列表中最接近的档位运行
  const thinkingLevel = requestedThinkingLevel === "auto" ? recommendedThinkingLevel : nearestThinkingLevel(requestedThinkingLevel, selectedModel?.thinkingLevels ?? []);

  const loadModels = useCallback(async () => {
    modelLoadControllerRef.current?.abort();
    const controller = new AbortController();
    modelLoadControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/models", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      const available = (typeof payload === "object" && payload !== null && "models" in payload ? payload.models : payload) as ModelDescriptor[];
      if (!Array.isArray(available) || available.length === 0) throw new Error("没有可用模型");
      if (!controller.signal.aborted && modelLoadControllerRef.current === controller) {
        setModels(available);
        let lastModel = "";
        try {
          lastModel = localStorage.getItem(LAST_MODEL_KEY) ?? "";
        } catch {
          // 隐私模式等场景下忽略
        }
        const preferred = settingsRef.current.defaultModel;
        setModelKey((current) => {
          if (current && available.some((model) => `${model.provider}:${model.id}` === current)) return current;
          if (lastModel && available.some((model) => `${model.provider}:${model.id}` === lastModel)) return lastModel;
          if (preferred && available.some((model) => `${model.provider}:${model.id}` === preferred)) return preferred;
          return `${available[0].provider}:${available[0].id}`;
        });
      }
    } catch (caught) {
      if (modelLoadControllerRef.current === controller) console.error("Unable to load models", caught);
    } finally {
      window.clearTimeout(timeout);
      if (modelLoadControllerRef.current === controller) {
        modelLoadControllerRef.current = null;
      }
    }
  }, []);

  const selectedSessionId = sessions.selectedSessionId;
  const resumeChat = chat.resume;
  const adoptSession = sessions.adoptSession;
  const refreshCurrentDetail = sessions.refreshCurrentDetail;
  const refreshSessions = sessions.refreshSessions;
  const removeRun = chat.removeRun;

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || resumedSessionIdsRef.current.has(selectedSessionId)) return;
    resumedSessionIdsRef.current.add(selectedSessionId);
    resumeChat(selectedSessionId, {
      onSessionId: (sessionId) => adoptSession(sessionId),
      onCompleted: (sessionId, runId) => {
        if (sessionId !== selectedSessionIdRef.current) setCompletedSessionIds((current) => new Set(current).add(sessionId));
        void refreshCurrentDetail(sessionId).finally(() => removeRun(runId));
        void refreshSessions(false);
      },
    });
  }, [adoptSession, refreshCurrentDetail, refreshSessions, removeRun, resumeChat, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || !isStreaming) return;
    let cancelled = false;
    const refreshLiveContext = async () => {
      try {
        const response = await fetch(`/api/chat/${encodeURIComponent(selectedSessionId)}/context`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object" || !("context" in payload)) return;
        if (!cancelled) setLiveContext({ sessionId: selectedSessionId, context: (payload as { context: SessionContextSummary }).context });
      } catch {
        // 短暂断网时保留最近一次上下文值。
      }
    };
    void refreshLiveContext();
    const interval = window.setInterval(() => { void refreshLiveContext(); }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isStreaming, selectedSessionId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const resourcesResponse = await fetch("/api/resources", { cache: "no-store", signal: controller.signal });
        if (resourcesResponse.ok && !controller.signal.aborted) setAgentResources(await resourcesResponse.json() as AgentResources);
      } catch {
      }
    })();
    const initialModelsLoad = window.setTimeout(() => { void loadModels(); }, 0);
    return () => {
      window.clearTimeout(initialModelsLoad);
      controller.abort();
      modelLoadControllerRef.current?.abort();
    };
  }, [loadModels]);

  const previewIsReadOnly = Boolean(sessions.detail?.previewEntryId && branchFromEntryId !== sessions.detail.previewEntryId);

  // “从此处编辑”分支时：分支点消息始终隐藏。详情仍为旧数据（编辑中/执行中）只显示分支点之前，
  // 避免旧分支闪现；详情刷新为新的分支投影后就绪，再显示分支点之后的新回复。
  const visibleConversation = useMemo(() => {
    const conversation = sessions.detail?.conversation ?? [];
    if (!branchFromEntryId) return conversation;
    const index = conversation.findIndex((item) => item.type === "user" && item.id === branchFromEntryId);
    if (index < 0) return conversation;
    if (isStreaming || !branchDetailReady) return conversation.slice(0, index);
    return [...conversation.slice(0, index), ...conversation.slice(index + 1)];
  }, [sessions.detail?.conversation, branchFromEntryId, isStreaming, branchDetailReady]);

  const showCommandNotice = useCallback((message: string, isError: boolean) => {
    setCommandNotice({ message, isError });
    if (commandNoticeTimerRef.current !== null) window.clearTimeout(commandNoticeTimerRef.current);
    commandNoticeTimerRef.current = window.setTimeout(() => setCommandNotice(null), isError ? 6000 : 3000);
  }, []);

  useEffect(() => () => {
    if (commandNoticeTimerRef.current !== null) window.clearTimeout(commandNoticeTimerRef.current);
  }, []);

  const submit = (images: ChatImage[]) => {
    const message = (composerRef.current?.value ?? prompt).trim();
    if ((!message && images.length === 0) || previewIsReadOnly) return false;
    const promptForModel = message || "请分析这张图片。";
    const sessionId = sessions.selectedSessionId ?? undefined;
    const projectId = sessionId ? undefined : selectedProjectId ?? undefined;

    // 流式中发送：不打断当前回复，插入为引导消息，当前回复完成后自动处理。
    if (isStreaming) {
      if (!sessionId) return false;
      void (async () => {
        try {
          const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/steer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: promptForModel, ...(images.length ? { images } : {}), behavior: steerBehavior }),
          });
          const payload = await response.json() as { error?: { message?: unknown } };
          if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "引导插入失败。");
          showCommandNotice("已插入引导，当前回复完成后自动处理。", false);
        } catch (caught) {
          showCommandNotice(caught instanceof Error ? caught.message : "引导插入失败。", true);
        }
      })();
      setPrompt("");
      return true;
    }

    setBranchDetailReady(false);
    const started = chat.send({
      prompt: promptForModel,
      images: images.length ? images : undefined,
      sessionId,
      branchFromEntryId,
      model: selectedModel ? { provider: selectedModel.provider, id: selectedModel.id } : undefined,
      thinkingLevel,
      resources: agentResources ? {
        skills: agentResources.skills.filter((item) => item.enabled).map((item) => item.id),
        plugins: agentResources.plugins.filter((item) => item.enabled).map((item) => item.id),
      } : undefined,
      projectId,
      autoRetry: settings.autoRetry,
    }, {
      onSessionId: (nextSessionId) => sessions.adoptSession(nextSessionId, projectId),
      onCompleted: (sessionId, runId) => {
        if (sessionId !== selectedSessionIdRef.current) setCompletedSessionIds((current) => new Set(current).add(sessionId));
        // 等详情刷新为新分支投影后标记就绪；分支标记保留，用于持续隐藏分支点消息。
        void sessions.refreshCurrentDetail(sessionId).finally(() => {
          setBranchDetailReady(true);
          removeRun(runId);
        });
        void sessions.refreshSessions(false);
      },
    }, promptForModel);
    if (started) {
      setPrompt("");
      if (commandNoticeTimerRef.current !== null) {
        window.clearTimeout(commandNoticeTimerRef.current);
        commandNoticeTimerRef.current = null;
      }
      setCommandNotice(null);
    }
    return started;
  };

  const runSlashCommand = useCallback(async (command: SlashCommand, argument: string): Promise<boolean> => {
    const sessionId = sessions.selectedSessionId;
    if (!sessionId) {
      showCommandNotice(`/${command.name} 需要先发送一条消息以创建会话。`, true);
      return false;
    }
    setCommandBusy(command.name);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: command.name, argument }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object") {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "object" && payload.error !== null && "message" in payload.error && typeof payload.error.message === "string"
          ? payload.error.message
          : `/${command.name} 执行失败。`;
        throw new Error(message);
      }
      const result = payload as { message?: unknown; text?: unknown };
      if (command.name === "copy") {
        if (typeof result.text !== "string") throw new Error("没有可复制的助手回复。");
        await copyTextToClipboard(result.text);
        showCommandNotice("已复制最后一条助手回复。", false);
      } else if (command.name === "session" && typeof result.text === "string") {
        showCommandNotice(result.text, false);
      } else {
        showCommandNotice(typeof result.message === "string" ? result.message : `/${command.name} 已完成。`, false);
      }
      if (command.name === "reload") {
        void loadModels();
        const resourcesResponse = await fetch("/api/resources", { cache: "no-store" });
        if (resourcesResponse.ok) setAgentResources(await resourcesResponse.json() as AgentResources);
      }
      await sessions.refreshCurrentDetail(sessionId);
      void sessions.refreshSessions(false);
      return true;
    } catch (error) {
      showCommandNotice(error instanceof Error ? error.message : `/${command.name} 执行失败。`, true);
      return false;
    } finally {
      setCommandBusy(null);
    }
  }, [loadModels, sessions, showCommandNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = Number(localStorage.getItem("pi-workbench-right-width"));
        if (Number.isFinite(stored) && stored >= 240 && stored <= 560) setRightWidth(stored);
      } catch {
      } finally {
        rightWidthRestoredRef.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!rightWidthRestoredRef.current) return;
    try {
      localStorage.setItem("pi-workbench-right-width", String(rightWidth));
    } catch {
      // 隐私模式下忽略持久化失败
    }
  }, [rightWidth]);

  const startRightResize = useCallback((event: React.PointerEvent) => {
    if (panelsCollapsed.right) return;
    rightResizeRef.current = { startX: event.clientX, startWidth: rightWidth };
    setRightResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      const start = rightResizeRef.current;
      if (!start) return;
      const next = Math.min(560, Math.max(240, start.startWidth - (moveEvent.clientX - start.startX)));
      setRightWidth(next);
    };
    const onUp = () => {
      rightResizeRef.current = null;
      setRightResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [panelsCollapsed.right, rightWidth]);

  const openModelConfig = () => {
    setRunConfigTab(null);
    setProviderConfigOpen(true);
  };

  const openPreview = useCallback((path: string, line?: number) => {
    setPreviewPath(path);
    setPreviewLine(line ?? null);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setPreviewLine(null);
  }, []);


  const openGlobalSettings = () => {
    setGlobalSettingsOpen(true);
  };

  const handleUserMessageAction = useCallback((action: "copy" | "edit" | "fork", content: string, entryId?: string) => {
    if (action === "copy") {
      void copyTextToClipboard(content).then(
        () => showCommandNotice("已复制该用户消息。", false),
        () => showCommandNotice("复制失败，请重试。", true),
      );
      return;
    }
    if (action === "edit") {
      if (!entryId) return;
      setBranchFromEntryId(entryId);
      setBranchDetailReady(false);
      setPrompt(content);
      requestAnimationFrame(() => {
        const target = composerRef.current;
        target?.focus();
        target?.setSelectionRange(content.length, content.length);
      });
      return;
    }
    if (action === "fork" && entryId) {
      const sessionId = sessions.selectedSessionId;
      if (!sessionId) return;
      void sessions.forkSession(sessionId, entryId).then((ok) => {
        if (ok) {
          setBranchFromEntryId(undefined);
          setBranchDetailReady(false);
          showCommandNotice("已从该消息创建新会话。", false);
        }
      });
    }
  }, [sessions, showCommandNotice]);

  const insertReference = (reference: string) => {
    const target = composerRef.current;
    const insertion = insertFileReference(prompt, target?.selectionStart ?? prompt.length, reference);
    setPrompt(insertion.value);
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
    });
  };

  return (
    <main className={`workbench${rightResizing ? " resizing" : ""}`} style={{ "--left-w": panelsCollapsed.left ? "0px" : "264px", "--right-w": panelsCollapsed.right ? "0px" : `${rightWidth}px` } as React.CSSProperties}>
      {!panelsCollapsed.left ? (
        <div className="panel-grip-zone left"><button type="button" className="panel-grip left-collapse" onClick={() => setPanelsCollapsed((current) => ({ ...current, left: true }))} aria-label="收起左侧栏" title="收起左侧栏"><span aria-hidden="true">‹</span></button></div>
      ) : (
        <div className="panel-grip-zone left"><button type="button" className="panel-grip left-open" onClick={() => setPanelsCollapsed((current) => ({ ...current, left: false }))} aria-label="展开左侧栏" title="展开左侧栏"><span aria-hidden="true">›</span></button></div>
      )}
      {!panelsCollapsed.right ? (
        <div className="panel-grip-zone right"><button type="button" className="panel-grip right-collapse" onClick={() => setPanelsCollapsed((current) => ({ ...current, right: true }))} aria-label="收起右侧栏" title="收起右侧栏"><span aria-hidden="true">›</span></button></div>
      ) : (
        <div className="panel-grip-zone right"><button type="button" className="panel-grip right-open" onClick={() => setPanelsCollapsed((current) => ({ ...current, right: false }))} aria-label="展开右侧栏" title="展开右侧栏"><span aria-hidden="true">‹</span></button></div>
      )}
      {mobileDrawer ? <button type="button" className="mobile-drawer-backdrop" onClick={() => setMobileDrawer(null)} aria-label="关闭侧栏" /> : null}
      <aside className={`sidebar${panelsCollapsed.left ? " collapsed" : ""}${mobileDrawer === "sessions" ? " mobile-open" : ""}`} aria-label="会话与运行配置">
        <header className="mobile-drawer-header"><h2>会话与配置</h2><div className="mobile-drawer-actions"><button type="button" className="mobile-drawer-new" onClick={() => { setBranchFromEntryId(undefined); setBranchDetailReady(false); sessions.createSession(selectedProjectId); setMobileDrawer(null); }} aria-label="新建会话" title="新建会话">＋</button><button type="button" onClick={() => setMobileDrawer(null)} aria-label="关闭会话侧栏">×</button></div></header>
        <SessionSidebar
          sessions={sessions.sessions}
          projects={sessions.projects}
          sessionProjectIds={sessions.sessionProjectIds}
          selectedProjectId={sessions.selectedProjectId}
          selectedSessionId={sessions.selectedSessionId}
          seenSessionIds={sessions.seenSessionIds}
          completedSessionIds={completedSessionIds}
          isLoading={sessions.isLoading}
          runningSessionIds={chat.runningSessionIds}
          onNewSession={(projectId: string | null) => { setBranchFromEntryId(undefined); setBranchDetailReady(false); sessions.createSession(projectId); setMobileDrawer(null); }}
          onSelectSession={(sessionId) => { setCompletedSessionIds((current) => { if (!current.has(sessionId)) return current; const next = new Set(current); next.delete(sessionId); return next; }); setBranchFromEntryId(undefined); setBranchDetailReady(false); sessions.selectSession(sessionId); setMobileDrawer(null); }}
          onSelectProject={(projectId) => { sessions.selectProject(projectId); setMobileDrawer(null); }}
          onCreateProject={sessions.createProject}
          onRenameProject={sessions.renameProject}
          onDeleteProject={sessions.deleteProject}
          onRenameSession={sessions.renameSession}
          onDeleteSession={sessions.deleteSession}
        />
        <section className="settings-section" aria-label="运行配置">

          <nav className="run-config-tabs" aria-label="运行配置视图">
            <button type="button" className={providerConfigOpen ? "selected" : ""} onClick={openModelConfig}><span aria-hidden="true">⚙</span>模型</button>
            <button type="button" className={runConfigTab === "skills" ? "selected" : ""} onClick={() => setRunConfigTab("skills")}><span aria-hidden="true">▱</span>技能</button>
            <button type="button" className={runConfigTab === "plugins" ? "selected" : ""} onClick={() => setRunConfigTab("plugins")}><span aria-hidden="true"><svg className="run-config-icon" viewBox="0 0 24 24"><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></svg></span>插件</button>
          </nav>
        </section>
      </aside>

      <section className="chat-panel" aria-label="聊天">
        <ChatHeader title={sessions.detail?.session.name || "对话"} usage={sessions.detail?.usage} context={displayedContext} tokenSpeed={activeRun?.tokenSpeed ?? 0} isStreaming={isStreaming} onOpenSessions={() => setMobileDrawer("sessions")} onOpenWorkspace={() => setMobileDrawer("workspace")} />
        {sessions.error ? <p className="page-error" role="alert">{sessions.error}</p> : null}
        {commandBusy ? <p className="command-notice busy" role="status">正在执行 /{commandBusy} …</p> : null}
        {commandNotice ? <p className={`command-notice${commandNotice.isError ? " error" : ""}`} role={commandNotice.isError ? "alert" : "status"}>{commandNotice.message}</p> : null}
        <CompletionToast toasts={toasts} onDismiss={dismissToast} />
        <ConversationView
          conversation={visibleConversation}
          pendingPrompt={activeRun?.pendingPrompt ?? ""}
          timeline={activeRun?.timeline ?? []}
          retry={activeRun?.retry ?? null}
          error={activeRun?.error ?? ""}
          isStreaming={activeRun?.isStreaming ?? false}
          runId={activeRun?.runId ?? ""}
          isLoading={sessions.isLoadingDetail}
          truncated={sessions.detail?.truncated.conversation ?? false}
          onLoadEarlier={sessions.loadEarlierConversation}
          loadingEarlier={sessions.isLoadingEarlierConversation}
          models={models}
          liveModelName={selectedModel?.name ?? "模型"}
          onUserMessageAction={handleUserMessageAction}
          runStartedAt={activeRun?.startedAt}
          runFinishedAt={activeRun?.finishedAt}
          runReplay={activeRun?.replay}
        />
        {previewIsReadOnly ? <p className="branch-notice">正在只读查看历史节点。请选择“从此继续”后再发送消息。</p> : null}
        <ChatComposer key={`${selectedProjectId ?? "default"}:${sessions.selectedSessionId ?? "new"}:${branchFromEntryId ?? "active"}`} value={prompt} projectId={selectedProjectId} models={models} modelKey={effectiveModelKey} onModelChange={(nextModelKey) => { const nextModel = models.find((model) => `${model.provider}:${model.id}` === nextModelKey); setUserTouchedModel(true); try { localStorage.setItem(LAST_MODEL_KEY, nextModelKey); } catch { /* 忽略持久化失败 */ } setModelKey(nextModelKey);  }} thinkingLevel={requestedThinkingLevel} thinkingLevels={selectedModel?.thinkingLevels ?? []} recommendedThinkingLevel={recommendedThinkingLevel} onThinkingLevelChange={(nextLevel) => setSessionThinkingLevels((current) => (current[thinkingKey] === nextLevel ? current : { ...current, [thinkingKey]: nextLevel }))} onOpenGlobalSettings={openGlobalSettings} onOpenSystemPrompt={() => setSystemPromptOpen(true)} disabled={previewIsReadOnly} isStreaming={isStreaming} onChange={setPrompt} onSubmit={submit} onCommand={runSlashCommand} onStop={() => { if (activeRun) chat.stop(activeRun.id); }} inputRef={composerRef} steerBehavior={steerBehavior} onSteerBehaviorChange={setSteerBehavior} queued={activeRun?.queued} stopping={activeRun?.stopping} />
      </section>

      {systemPromptOpen ? <SystemPromptModal projectId={sessions.selectedProjectId} onClose={() => setSystemPromptOpen(false)} /> : null}
      {globalSettingsOpen ? <GlobalSettingsModal models={models} onClose={() => setGlobalSettingsOpen(false)} /> : null}
      {providerConfigOpen ? <ProviderConfigModal onClose={() => setProviderConfigOpen(false)} onChanged={() => { void loadModels(); }} /> : null}
      {runConfigTab ? <AgentResourcesModal kind={runConfigTab} onClose={() => setRunConfigTab(null)} onChanged={setAgentResources} /> : null}

      <WorkspaceFilePreview key={`${selectedProjectId ?? "default"}:${previewPath ?? "closed"}`} path={previewPath} projectId={selectedProjectId} initialLine={previewLine} onClose={closePreview} onInsert={insertReference} />
      <WorkspaceGitDiff diff={git.diff} loading={git.diffLoading} error={git.diffError} onClose={git.closeDiff} />

      {!panelsCollapsed.right ? <div className="panel-resize" onPointerDown={startRightResize} aria-hidden="true" /> : null}
      <WorkbenchSidePanel
        nodes={workspace.nodes}
        onLoadPath={workspace.loadPath}
        onOpenFile={openPreview}
        git={git}
        detail={sessions.detail}
        isLoadingSession={sessions.isLoadingDetail}
        projectId={selectedProjectId}
        collapsed={panelsCollapsed.right}
        mobileOpen={mobileDrawer === "workspace"}
        onCloseMobile={() => setMobileDrawer(null)}
        subagents={subagents.activities}
        agents={subagents.agents}
        agentsLoading={subagents.agentsLoading}
        agentsError={subagents.agentsError}
      />
    </main>
  );
}
