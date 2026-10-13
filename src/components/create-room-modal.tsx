"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelDescriptor } from "@/contracts";

export type RoleDraft = {
  role: string;
  modelKey: string;
  /** 角色卡名（对应 ~/.pi/agent/role-cards/<名称>.md，内容每轮动态读取并注入） */
  roleCard: string;
  /** 角色卡之外的补充说明（可选） */
  rolePrompt: string;
};

export type RoleCardSummary = { name: string; summary: string; content: string };

type CreateRoomModalProps = {
  models: ModelDescriptor[];
  projectName?: string | null;
  creating?: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; roles: Array<{ role: string; modelKey: string; roleCard?: string; rolePrompt?: string }> }) => Promise<void>;
};

const MAX_ROLES = 8;

function modelKeyOf(model: ModelDescriptor): string {
  return `${model.provider}:${model.id}`;
}

/** 新建聊天室：配置参与角色、各自模型与角色卡（角色卡来自 ~/.pi/agent/role-cards/*.md）。 */
export function CreateRoomModal({ models, projectName, creating = false, onClose, onCreate }: CreateRoomModalProps) {
  const defaultModelKey = models[0] ? modelKeyOf(models[0]) : "";
  const [name, setName] = useState("多模型协作");
  const [roles, setRoles] = useState<RoleDraft[]>(() => [
    { role: "", modelKey: defaultModelKey, roleCard: "", rolePrompt: "" },
    { role: "", modelKey: defaultModelKey, roleCard: "", rolePrompt: "" },
  ]);
  const [cards, setCards] = useState<RoleCardSummary[]>([]);
  const [cardsDirectory, setCardsDirectory] = useState("");
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // 角色卡从文件目录动态获取（文件名即角色名）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/role-cards", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { cards?: RoleCardSummary[]; directory?: string };
        if (cancelled) return;
        setCards(payload.cards ?? []);
        setCardsDirectory(payload.directory ?? "");
        // 默认选中前两张角色卡，方便直接创建
        setRoles((current) => current.map((item, index) => (
          item.roleCard || !payload.cards?.[index] ? item : { ...item, roleCard: payload.cards[index].name, role: item.role || payload.cards[index].name }
        )));
      } catch {
        // 读取失败时保持空列表（角色卡可稍后在房间内选择）
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [creating, onClose]);

  const patchRole = (index: number, patch: Partial<RoleDraft>) => {
    setRoles((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  };

  const addRole = () => {
    if (roles.length >= MAX_ROLES) return;
    setRoles((current) => [...current, { role: "", modelKey: defaultModelKey, roleCard: "", rolePrompt: "" }]);
    setExpandedIndex(roles.length);
  };

  const removeRole = (index: number) => {
    setRoles((current) => current.filter((_, position) => position !== index));
    setExpandedIndex((current) => (current === index ? null : current !== null && current > index ? current - 1 : current));
  };

  const selectCard = (index: number, cardName: string) => {
    const card = cards.find((item) => item.name === cardName);
    patchRole(index, { roleCard: cardName, ...(card && !roles[index].role.trim() ? { role: card.name } : {}) });
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写房间名称。");
      return;
    }
    const cleaned = roles.map((item) => ({
      role: item.role.trim() || item.roleCard.trim(),
      modelKey: item.modelKey,
      roleCard: item.roleCard.trim(),
      rolePrompt: item.rolePrompt.trim(),
    }));
    if (cleaned.length === 0) {
      setError("至少需要一个角色。");
      return;
    }
    if (cleaned.some((item) => !item.role)) {
      setError("每个角色都需要角色名（或选择角色卡）。");
      return;
    }
    if (cleaned.some((item) => !item.modelKey)) {
      setError("每个角色都需要选择模型。");
      return;
    }
    if (new Set(cleaned.map((item) => item.role)).size !== cleaned.length) {
      setError("角色名不能重复。");
      return;
    }
    setError("");
    try {
      await onCreate({
        name: trimmedName,
        roles: cleaned.map((item) => ({
          role: item.role,
          modelKey: item.modelKey,
          ...(item.roleCard ? { roleCard: item.roleCard } : {}),
          ...(item.rolePrompt ? { rolePrompt: item.rolePrompt } : {}),
        })),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败。");
    }
  };

  return (
    <div className="create-room-backdrop" role="dialog" aria-modal="true" aria-label="新建聊天室">
      <div className="create-room-panel">
        <header className="create-room-header">
          <div>
            <h2>新建聊天室</h2>
            <p className="create-room-subtitle">
              {projectName ? `项目「${projectName}」· ` : "无项目 · "}每个角色是一个独立会话，可随时更换模型
            </p>
          </div>
          <button type="button" className="create-room-close" onClick={onClose} disabled={creating} aria-label="关闭">×</button>
        </header>

        <div className="create-room-body">
          <label className="create-room-field">
            <span>房间名称</span>
            <input ref={nameRef} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如：需求评审" />
          </label>

          <div className="create-room-section">
            <div className="create-room-section-head">
              <span>角色与模型</span>
              <span className="create-room-count">{roles.length}/{MAX_ROLES}</span>
            </div>

            {roles.map((item, index) => {
              const expanded = expandedIndex === index;
              const card = cards.find((entry) => entry.name === item.roleCard);
              return (
                <div key={index} className={`create-room-role${expanded ? " expanded" : ""}`}>
                  <div className="create-room-role-row">
                    <input
                      className="create-room-role-name"
                      value={item.role}
                      maxLength={40}
                      placeholder="角色名"
                      onChange={(event) => patchRole(index, { role: event.target.value })}
                    />
                    <select
                      className="create-room-role-card-select"
                      value={item.roleCard}
                      onChange={(event) => selectCard(index, event.target.value)}
                      title="角色卡（来自 ~/.pi/agent/role-cards/*.md）"
                    >
                      <option value="">（不绑定角色卡）</option>
                      {cards.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
                    </select>
                    <select
                      className="create-room-role-model"
                      value={item.modelKey}
                      onChange={(event) => patchRole(index, { modelKey: event.target.value })}
                    >
                      {models.length === 0 ? <option value="">（无可用模型）</option> : null}
                      {models.map((model) => <option key={modelKeyOf(model)} value={modelKeyOf(model)}>{model.name}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`create-room-role-card-toggle${expanded ? " active" : ""}`}
                      onClick={() => setExpandedIndex(expanded ? null : index)}
                      title="查看角色卡内容与补充说明"
                    >
                      {expanded ? "收起" : "详情"}
                    </button>
                    <button
                      type="button"
                      className="create-room-role-remove"
                      onClick={() => removeRole(index)}
                      disabled={roles.length <= 1}
                      aria-label={`移除角色 ${item.role || index + 1}`}
                      title="移除角色"
                    >
                      ×
                    </button>
                  </div>
                  {expanded ? (
                    <div className="create-room-role-card">
                      {card ? (
                        <pre className="create-room-role-card-content">{card.content.trim().slice(0, 1200)}</pre>
                      ) : (
                        <p className="create-room-role-card-empty">
                          {cards.length === 0 ? "还没有角色卡文件。" : "未绑定角色卡（仅使用补充说明）。"}
                          {cardsDirectory ? <span className="create-room-role-card-dir">目录：{cardsDirectory}</span> : null}
                        </p>
                      )}
                      <textarea
                        value={item.rolePrompt}
                        maxLength={4000}
                        rows={2}
                        placeholder="补充说明（可选）：在角色卡之外额外强调的要求，同样每轮注入。"
                        onChange={(event) => patchRole(index, { rolePrompt: event.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}

            <button type="button" className="create-room-add" onClick={addRole} disabled={roles.length >= MAX_ROLES}>＋ 添加角色</button>
            <p className="create-room-hint">
              角色卡从 markdown 文件读取：{cardsDirectory || "~/.pi/agent/role-cards"}（文件名即角色名，编辑文件后立即生效）
            </p>
          </div>
        </div>

        <footer className="create-room-footer">
          <span className="create-room-error" role="alert">{error}</span>
          <div className="create-room-actions">
            <button type="button" className="create-room-cancel" onClick={onClose} disabled={creating}>取消</button>
            <button type="button" className="create-room-submit" onClick={() => void submit()} disabled={creating || models.length === 0}>
              {creating ? "创建中…" : "创建聊天室"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
