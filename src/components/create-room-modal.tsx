"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelDescriptor } from "@/contracts";

export type RoleDraft = {
  role: string;
  modelKey: string;
  /** 角色卡：预设提示词，该角色每轮被触发时都会注入 */
  rolePrompt: string;
};

type CreateRoomModalProps = {
  models: ModelDescriptor[];
  projectName?: string | null;
  creating?: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; roles: Array<{ role: string; modelKey: string; rolePrompt?: string }> }) => Promise<void>;
};

/** 内置角色卡模板：一键填充常用的职责设定。 */
export const ROLE_CARD_TEMPLATES: Array<{ role: string; prompt: string }> = [
  { role: "开发者", prompt: "你负责把讨论结论落成可运行、可维护的实现：给出具体改动（文件/接口/数据结构）、边界处理与验证方式；不确定处显式标注为假设，不假装已完成。" },
  { role: "审查者", prompt: "你负责独立核对其他角色的结论：逐条检查证据是否充分、逻辑是否有跳跃、是否存在未被发现的反例；只依据可验证的事实发言，必要时给出可复现的失败样例。" },
  { role: "架构师", prompt: "你关注系统边界、接口契约与长期可演进性：评估方案的可扩展性、耦合度、失败模式与迁移成本，明确给出取舍建议与理由。" },
  { role: "产品经理", prompt: "你关注用户价值与交付范围：明确目标、验收标准与优先级，阻止范围蔓延，确保每一步产出都能被验收。" },
];

const MAX_ROLES = 8;

function modelKeyOf(model: ModelDescriptor): string {
  return `${model.provider}:${model.id}`;
}

/** 新建聊天室：配置参与角色、各自模型与角色卡。 */
export function CreateRoomModal({ models, projectName, creating = false, onClose, onCreate }: CreateRoomModalProps) {
  const defaultModelKey = models[0] ? modelKeyOf(models[0]) : "";
  const [name, setName] = useState("多模型协作");
  const [roles, setRoles] = useState<RoleDraft[]>(() => [
    { role: ROLE_CARD_TEMPLATES[0].role, modelKey: defaultModelKey, rolePrompt: ROLE_CARD_TEMPLATES[0].prompt },
    { role: ROLE_CARD_TEMPLATES[1].role, modelKey: defaultModelKey, rolePrompt: ROLE_CARD_TEMPLATES[1].prompt },
  ]);
  const [error, setError] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
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
    setRoles((current) => [...current, { role: "", modelKey: defaultModelKey, rolePrompt: "" }]);
    setExpandedIndex(roles.length);
  };

  const removeRole = (index: number) => {
    setRoles((current) => current.filter((_, position) => position !== index));
    setExpandedIndex((current) => (current === index ? null : current !== null && current > index ? current - 1 : current));
  };

  const applyTemplate = (index: number, template: { role: string; prompt: string }) => {
    patchRole(index, { role: template.role, rolePrompt: template.prompt });
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写房间名称。");
      return;
    }
    const cleaned = roles.map((item) => ({ role: item.role.trim(), modelKey: item.modelKey, rolePrompt: item.rolePrompt.trim() }));
    if (cleaned.length === 0) {
      setError("至少需要一个角色。");
      return;
    }
    if (cleaned.some((item) => !item.role)) {
      setError("每个角色都需要填写角色名。");
      return;
    }
    if (cleaned.some((item) => !item.modelKey)) {
      setError("每个角色都需要选择模型。");
      return;
    }
    const unique = new Set(cleaned.map((item) => item.role));
    if (unique.size !== cleaned.length) {
      setError("角色名不能重复。");
      return;
    }
    setError("");
    try {
      await onCreate({
        name: trimmedName,
        roles: cleaned.map((item) => ({ role: item.role, modelKey: item.modelKey, ...(item.rolePrompt ? { rolePrompt: item.rolePrompt } : {}) })),
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
                      className="create-room-role-model"
                      value={item.modelKey}
                      onChange={(event) => patchRole(index, { modelKey: event.target.value })}
                    >
                      {models.length === 0 ? <option value="">（无可用模型）</option> : null}
                      {models.map((model) => <option key={modelKeyOf(model)} value={modelKeyOf(model)}>{model.name}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`create-room-role-card-toggle${item.rolePrompt.trim() ? " active" : ""}`}
                      onClick={() => setExpandedIndex(expanded ? null : index)}
                      title={item.rolePrompt.trim() ? "已设置角色卡" : "设置角色卡（预设提示词，每轮注入）"}
                    >
                      角色卡{item.rolePrompt.trim() ? " ✓" : ""}
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
                      <textarea
                        value={item.rolePrompt}
                        maxLength={4000}
                        rows={3}
                        placeholder="角色卡：这个角色的职责、关注点与边界。每次该角色被触发时都会注入，用于持续约束它的行为。"
                        onChange={(event) => patchRole(index, { rolePrompt: event.target.value })}
                      />
                      <div className="create-room-templates">
                        <span>快速填充</span>
                        {ROLE_CARD_TEMPLATES.map((template) => (
                          <button key={template.role} type="button" onClick={() => applyTemplate(index, template)}>{template.role}</button>
                        ))}
                        {item.rolePrompt.trim() ? (
                          <button type="button" className="create-room-template-clear" onClick={() => patchRole(index, { rolePrompt: "" })}>清空</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            <button type="button" className="create-room-add" onClick={addRole} disabled={roles.length >= MAX_ROLES}>＋ 添加角色</button>
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
