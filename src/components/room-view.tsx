"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelDescriptor, RoomMessage, RoomParticipant } from "@/contracts";
import type { RoomDetail } from "@/client/use-rooms";
import { ChatMarkdown } from "@/components/chat-markdown";

type RoomViewProps = {
  detail: RoomDetail;
  models: ModelDescriptor[];
  disabled?: boolean;
  onSend: (content: string, targetParticipantId?: string) => Promise<void>;
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

/**
 * 聊天室视图：
 * - 群聊：房间公开消息 + 各角色发言，用户发言会触发所有角色响应。
 * - 单角色（点击角色名进入）：该角色在群聊中的发言 + 与它的私聊，可单独对话、随时更换它的模型。
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
  const scrollRef = useRef<HTMLDivElement>(null);

  const { room, messages } = detail;
  const focusParticipant = focusParticipantId ? room.participants.find((participant) => participant.id === focusParticipantId) ?? null : null;

  const visibleMessages = useMemo(() => {
    if (focusParticipant) {
      // 单角色视图：该角色在群聊中的发言 + 与它的私聊（其他角色看不到的对话）
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
  }, [visibleMessages.length, focusParticipantId]);

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

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending || disabled) return;
    setSending(true);
    setError("");
    try {
      await onSend(content, focusParticipant?.id);
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败。");
    } finally {
      setSending(false);
    }
  };

  const renderMessage = (message: RoomMessage) => {
    const isUser = message.sender.type === "user";
    const role = message.sender.type === "participant" ? message.sender.role : "";
    return (
      <article key={message.id} className={isUser ? "room-message room-message-user" : "room-message room-message-participant"}>
        <header className="room-message-head">
          {isUser ? (
            <span className="room-message-author">用户</span>
          ) : (
            <button
              type="button"
              className="room-message-author room-message-author-button"
              onClick={() => setFocusParticipantId(message.sender.type === "participant" ? message.sender.participantId : null)}
              title={`进入「${role}」的单独对话`}
            >
              {role}
            </button>
          )}
          {message.visibility === "private" ? <span className="room-message-private">私聊</span> : null}
          <time className="room-message-time">{formatTime(message.createdAt)}</time>
        </header>
        <div className="room-message-body"><ChatMarkdown content={message.content} /></div>
      </article>
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
      </header>

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

      <div className="room-messages" ref={scrollRef}>
        {visibleMessages.length === 0 ? (
          <p className="room-empty">
            {focusParticipant ? `还没有与「${focusParticipant.role}」的对话。这里的消息只有它能看到。` : "房间还没有消息。在下面发言，所有角色都会响应。"}
          </p>
        ) : visibleMessages.map(renderMessage)}
      </div>

      {error ? <p className="chat-error" role="alert">{error}</p> : null}

      <div className="room-composer">
        <textarea
          className="room-composer-input"
          value={draft}
          placeholder={focusParticipant ? `单独对「${focusParticipant.role}」说…（其他角色看不到）` : "在聊天室里发言…所有角色都会收到并响应"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
        />
        <button type="button" className="send-button" onClick={() => void submit()} disabled={sending || disabled || !draft.trim()}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
