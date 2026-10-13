"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelDescriptor, RoomMessage, RoomParticipant, SessionDetail } from "@/contracts";
import type { RoomDetail } from "@/client/use-rooms";
import { useChatStream } from "@/client/use-chat-stream";
import { useRoomStreams } from "@/client/use-room-streams";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ConversationView } from "@/components/conversation-view";

type RoomViewProps = {
  detail: RoomDetail;
  models: ModelDescriptor[];
  disabled?: boolean;
  onSend: (content: string, targetParticipantId?: string) => Promise<{ reason: string; detail: string } | undefined>;
  onChangeModel: (participantId: string, modelKey: string) => Promise<void>;
  onAddParticipant: (role: string, modelKey: string) => Promise<void>;
  onRemoveParticipant: (participantId: string) => Promise<void>;
  onRenameRoom: (name: string) => Promise<void>;
};

function modelLabel(models: ModelDescriptor[], modelKey: string): string {
  const model = models.find((candidate) => `${candidate.provider}:${candidate.id}` === modelKey);
  return model?.name ?? modelKey;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function avatarText(role: string): string {
  const trimmed = role.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

const EMPTY_QUEUE: never[] = [];

/**
 * 聊天室视图（微信群聊风格）。
 *
 * 群聊本质是多个默认会话拼起来：
 * - 每个角色就是一个普通 pi 会话；
 * - 单角色视图直接复用默认会话的渲染（ConversationView + use-chat-stream），行为与默认会话一致；
 * - 群聊视图在此之上做聚合：正式消息用左右气泡展示，正在响应的角色用实时流呈现打字机效果。
 */
export function RoomView({ detail, models, disabled, onSend, onChangeModel, onAddParticipant, onRemoveParticipant, onRenameRoom }: RoomViewProps) {
  const [focusParticipantId, setFocusParticipantId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(detail.room.name);
  const [newRole, setNewRole] = useState("");
  const [newRoleModel, setNewRoleModel] = useState("");
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [participantDetail, setParticipantDetail] = useState<SessionDetail | null>(null);
  const [routingNotice, setRoutingNotice] = useState("");
  const routingTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resumedSessionRef = useRef<string | null>(null);

  const { room, messages } = detail;
  const focusParticipant = focusParticipantId ? room.participants.find((participant) => participant.id === focusParticipantId) ?? null : null;
  const runningParticipantIds = useMemo(() => detail.runningParticipantIds ?? [], [detail.runningParticipantIds]);

  // 群聊：订阅各运行中角色的实时输出（打字机效果）
  const roomStreams = useRoomStreams(room.participants, runningParticipantIds);
  // 单角色视图：直接复用默认会话的实时流机制
  const participantChat = useChatStream();
  const participantSessionId = focusParticipant?.sessionId ?? null;
  const participantRun = participantSessionId ? participantChat.runFor(participantSessionId) : undefined;

  const runningParticipants = useMemo(
    () => room.participants.filter((participant) => runningParticipantIds.includes(participant.id)),
    [room.participants, runningParticipantIds],
  );

  const loadParticipantDetail = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) return;
      setParticipantDetail((await response.json()) as SessionDetail);
    } catch {
      // 详情拉取失败时保留上一次内容
    }
  }, []);

  // 切到某个角色：拉取其会话详情（与默认会话相同的数据源），并在运行中时接入实时流
  useEffect(() => {
    if (!participantSessionId) {
      setParticipantDetail(null);
      return;
    }
    if (resumedSessionRef.current === participantSessionId) return;
    resumedSessionRef.current = participantSessionId;
    setParticipantDetail(null);
    void loadParticipantDetail(participantSessionId);
    participantChat.resume(participantSessionId);
  }, [participantSessionId, loadParticipantDetail, participantChat]);

  // 角色回复结束：刷新会话详情，让正式消息取代实时流内容
  const participantStreaming = participantRun?.isStreaming ?? false;
  useEffect(() => {
    if (participantStreaming || !participantSessionId) return;
    void loadParticipantDetail(participantSessionId);
  }, [participantStreaming, participantSessionId, loadParticipantDetail]);

  const visibleMessages = useMemo(() => {
    if (focusParticipant) {
      // 单角色视图：该角色在群聊中的发言 + 与它的私聊
      return messages.filter((message) => {
        if (message.visibility === "private") return message.targetParticipantId === focusParticipant.id;
        return message.sender.type === "user" || (message.sender.type === "participant" && message.sender.participantId === focusParticipant.id);
      });
    }
    return messages.filter((message) => message.visibility === "room");
  }, [focusParticipant, messages]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [visibleMessages.length, runningParticipants.length, focusParticipantId, participantRun?.timeline.length]);

  useEffect(() => {
    setNameDraft(room.name);
  }, [room.name]);

  useEffect(() => {
    if (!focusParticipantId) return;
    if (!room.participants.some((participant) => participant.id === focusParticipantId)) setFocusParticipantId(null);
  }, [focusParticipantId, room.participants]);

  useEffect(() => {
    if (!newRoleModel && models.length > 0) setNewRoleModel(`${models[0].provider}:${models[0].id}`);
  }, [models, newRoleModel]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 180)}px`;
  }, [draft]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending || disabled) return;
    setSending(true);
    setError("");
    try {
      const routing = await onSend(content, focusParticipant?.id);
      setDraft("");
      if (routing?.detail) {
        setRoutingNotice(routing.detail);
        if (routingTimerRef.current !== null) window.clearTimeout(routingTimerRef.current);
        routingTimerRef.current = window.setTimeout(() => setRoutingNotice(""), 6_000);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败。");
    } finally {
      setSending(false);
    }
  };

  /** 把 @角色名 高亮（用 markdown 加粗），让“在和谁说话”一眼可见。 */
  const highlightMentions = (content: string) => {
    let result = content;
    for (const participant of room.participants) {
      if (!participant.role) continue;
      const escaped = participant.role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`[@＠]${escaped}`, "g"), `**@${participant.role}**`);
    }
    return result;
  };

  const renderMessage = (message: RoomMessage) => {
    const isUser = message.sender.type === "user";
    const role = message.sender.type === "participant" ? message.sender.role : "";
    const participantId = message.sender.type === "participant" ? message.sender.participantId : null;
    return (
      <div key={message.id} className={`chat-row ${isUser ? "chat-row-out" : "chat-row-in"}`}>
        {isUser ? null : (
          <button
            type="button"
            className="chat-avatar"
            onClick={() => participantId && setFocusParticipantId(participantId)}
            title={`与「${role}」单独对话`}
            aria-label={`与 ${role} 单独对话`}
          >
            {avatarText(role)}
          </button>
        )}
        <div className="chat-column">
          <div className="chat-meta">
            {isUser ? <span className="chat-author">我</span> : (
              <button type="button" className="chat-author chat-author-button" onClick={() => participantId && setFocusParticipantId(participantId)} title={`与「${role}」单独对话`}>
                {role}
              </button>
            )}
            {message.visibility === "private" ? <span className="chat-private-tag">私聊</span> : null}
            <time className="chat-time">{formatTime(message.createdAt)}</time>
          </div>
          <div className={`chat-bubble${isUser ? " chat-bubble-out" : ""}`}>
            <ChatMarkdown content={isUser ? highlightMentions(message.content) : message.content} />
          </div>
        </div>
      </div>
    );
  };

  /** 运行中的角色：有实时文本就逐字渲染（打字机），否则显示“正在输入…”。 */
  const renderLive = (participant: RoomParticipant) => {
    const stream = roomStreams[participant.id];
    const text = stream?.text?.trim() ?? "";
    return (
      <div key={`live-${participant.id}`} className="chat-row chat-row-in">
        <button
          type="button"
          className="chat-avatar"
          onClick={() => setFocusParticipantId(participant.id)}
          title={`与「${participant.role}」单独对话`}
          aria-label={`与 ${participant.role} 单独对话`}
        >
          {avatarText(participant.role)}
        </button>
        <div className="chat-column">
          <div className="chat-meta">
            <button type="button" className="chat-author chat-author-button" onClick={() => setFocusParticipantId(participant.id)}>{participant.role}</button>
            <span className="chat-typing-label">正在输入…</span>
          </div>
          {text ? (
            <div className="chat-bubble chat-bubble-live">
              <ChatMarkdown content={text} />
              <span className="chat-caret" aria-hidden="true" />
            </div>
          ) : (
            <div className="chat-bubble chat-bubble-typing" role="status" aria-label={`${participant.role} 正在输入`}>
              <i /><i /><i />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="room-view">
      <header className="room-header">
        <div className="room-header-main">
          <button
            type="button"
            className="room-back"
            onClick={() => setFocusParticipantId(null)}
            disabled={!focusParticipant}
            aria-label="返回群聊"
            title="返回群聊"
          >
            {focusParticipant ? "← 群聊" : "聊天室"}
          </button>
          {editingName ? (
            <input
              className="room-name-input"
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => { setEditingName(false); if (nameDraft.trim() && nameDraft !== room.name) void onRenameRoom(nameDraft.trim()); }}
              onKeyDown={(event) => { if (event.key === "Enter") { setEditingName(false); if (nameDraft.trim() && nameDraft !== room.name) void onRenameRoom(nameDraft.trim()); } if (event.key === "Escape") { setNameDraft(room.name); setEditingName(false); } }}
            />
          ) : (
            <button type="button" className="room-name" onClick={() => setEditingName(true)} title="点击重命名聊天室">
              {room.name}
            </button>
          )}
          {focusParticipant ? <span className="room-focus-role">与「{focusParticipant.role}」单独对话</span> : null}
        </div>
        <div className="room-participants">
          {room.participants.map((participant) => (
            <span key={participant.id} className={`room-participant${focusParticipant?.id === participant.id ? " selected" : ""}`}>
              <button type="button" className="room-participant-name" onClick={() => setFocusParticipantId(participant.id)} title={`与「${participant.role}」单独对话`}>
                {participant.role}
              </button>
              <span className="room-participant-model">{modelLabel(models, participant.modelKey)}</span>
              {room.participants.length > 1 ? (
                <button type="button" className="room-participant-remove" onClick={() => void onRemoveParticipant(participant.id)} aria-label={`移除角色 ${participant.role}`} title="移除角色">×</button>
              ) : null}
            </span>
          ))}
          {room.participants.length < 8 ? (
            <button type="button" className="room-add-participant" onClick={() => setShowRoleForm((open) => !open)} title="添加角色">＋角色</button>
          ) : null}
        </div>
        {showRoleForm ? (
          <div className="room-role-form">
            <input className="room-role-input" value={newRole} placeholder="角色名（如：审查者）" onChange={(event) => setNewRole(event.target.value)} />
            <select className="room-role-model" value={newRoleModel} onChange={(event) => setNewRoleModel(event.target.value)}>
              {models.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>{model.name}</option>)}
            </select>
            <button
              type="button"
              className="room-role-add"
              disabled={!newRole.trim() || !newRoleModel}
              onClick={async () => {
                try {
                  await onAddParticipant(newRole.trim(), newRoleModel);
                  setNewRole("");
                  setShowRoleForm(false);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "添加角色失败。");
                }
              }}
            >
              添加
            </button>
          </div>
        ) : null}
        {focusParticipant ? (
          <div className="room-focus-bar">
            <label className="room-focus-model">
              <span>模型</span>
              <select
                value={focusParticipant.modelKey}
                onChange={(event) => void onChangeModel(focusParticipant.id, event.target.value)}
                title="更换该角色的模型（会话上下文保留）"
              >
                {models.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>{model.name}</option>)}
              </select>
            </label>
            <span className="room-focus-hint">换模型只影响后续回复，该角色的上下文（历史）保持不变</span>
          </div>
        ) : null}
      </header>

      {focusParticipant ? (
        // 单角色视图：照搬默认会话的渲染（思考、工具、打字机、Markdown 完全一致）
        <div className="room-messages room-messages-focus" ref={scrollRef}>
          {participantSessionId ? (
            <ConversationView
              conversation={participantDetail?.conversation ?? []}
              pendingPrompt={participantRun?.pendingPrompt ?? ""}
              timeline={participantRun?.timeline ?? []}
              pendingQueue={EMPTY_QUEUE}
              retry={participantRun?.retry ?? null}
              error={participantRun?.error ?? ""}
              isStreaming={participantStreaming}
              runId={participantRun?.runId ?? ""}
              isLoading={!participantDetail}
              truncated={participantDetail?.truncated.conversation ?? false}
              models={models}
              liveModelName={modelLabel(models, focusParticipant.modelKey)}
              runStartedAt={participantRun?.startedAt}
              runFinishedAt={participantRun?.finishedAt}
              runReplay={participantRun?.replay}
            />
          ) : (
            <p className="room-empty">这个角色还没有开始过对话。在下面发一条消息就会为它创建独立会话。</p>
          )}
        </div>
      ) : (
        <div className="room-messages" ref={scrollRef}>
          {visibleMessages.length === 0 && runningParticipants.length === 0 ? (
            <p className="room-empty">房间还没有消息。在下面发言，所有角色都会响应。</p>
          ) : visibleMessages.map(renderMessage)}
          {runningParticipants.map(renderLive)}
        </div>
      )}

      {routingNotice ? <p className="room-routing-notice" role="status">{routingNotice}</p> : null}
      {error ? <p className="chat-error" role="alert">{error}</p> : null}

      <div className="room-composer">
        <div className="room-composer-wrap">
          <textarea
            ref={inputRef}
            className="room-composer-input"
            value={draft}
            placeholder={focusParticipant
              ? `单独对「${focusParticipant.role}」说…（其他角色看不到）· Enter 发送`
              : "发消息 · @角色名 指定谁回应；说「大家」则全部响应 · Enter 发送"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            disabled={disabled}
          />
          <div className="room-composer-actions">
            <span className="room-composer-hint">
              {focusParticipant ? `私聊 · 只有「${focusParticipant.role}」会收到` : `群聊 · ${room.participants.length} 个角色都会收到并响应`}
            </span>
            <button type="button" className="send-button" onClick={() => void submit()} disabled={sending || disabled || !draft.trim()} aria-label="发送">
              {sending ? "…" : <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
