"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme, type Theme } from "@/client/theme";
import { useSettings, type FontStyle, type WorkbenchSettings } from "@/client/settings";
import { PromptFileEditorDialog } from "@/components/prompt-file-editor-dialog";
import type { ModelDescriptor, ThinkingLevel } from "@/contracts";
import { copyTextToClipboard } from "@/client/clipboard";
import { ACCESS_KEY_STORAGE } from "@/client/use-auth";

type GlobalSettingsModalProps = {
  models: ModelDescriptor[];
  onClose: () => void;
};

type SystemInfo = {
  host: string;
  port: string;
  localUrl: string;
  lanAddresses: string[];
  workspace: string;
  sessionDirectory: string;
  version: string;
  savedPort: number;
  savedWorkspace: string;
  projectWorkspacesRoot: string;
  savedProjectWorkspacesRoot: string;
  accessKey?: string;
};

type SettingsSectionId = "system" | "appearance" | "session";

const themes: Array<{ value: Theme; label: string }> = [
  { value: "dark", label: "黑夜" },
  { value: "light", label: "白天" },
];

const fontStyles: Array<{ value: FontStyle; label: string; hint: string }> = [
  { value: "yahei", label: "微软雅黑", hint: "当前默认" },
  { value: "system", label: "系统 UI", hint: "Segoe UI / 苹方" },
  { value: "mono", label: "等宽风", hint: "代码感" },
];

const thinkingLevels: Array<{ value: ThinkingLevel | ""; label: string }> = [
  { value: "", label: "自动" },
  { value: "off", label: "关闭" },
  { value: "minimal", label: "极简" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" },
];

const completionAlertOptions: Array<{ value: "off" | "page" | "desktop" | "both"; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "page", label: "仅页面" },
  { value: "desktop", label: "仅系统通知" },
  { value: "both", label: "两者" },
];

const sections: Array<{ id: SettingsSectionId; label: string; icon: ReactNode }> = [
  {
    id: "system",
    label: "系统",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="9" rx="2" /><path d="M7 18.5h10M12 14v4.5" /></svg>,
  },
  {
    id: "appearance",
    label: "外观和布局",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.2-1.6-.4-.9.3-1.9 1.3-1.9H16a3 3 0 0 0 3-3v-.5A2.5 2.5 0 0 0 16.5 12H14a2 2 0 0 1-2-2Z" /><circle cx="7.5" cy="10" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="5.5" r="1" /></svg>,
  },
  {
    id: "session",
    label: "默认会话行为",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="7" y="7" width="10" height="10" rx="5" /></svg>,
  },
];

function Segmented<T extends string | number>({ options, value, onChange, ariaLabel }: {
  options: Array<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="settings-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "selected" : ""}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function GlobalSettingsModal({ models, onClose }: GlobalSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const { settings, setSettings } = useSettings();
  const [sectionId, setSectionId] = useState<SettingsSectionId>("system");
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemInfoError, setSystemInfoError] = useState("");
  const [portDraft, setPortDraft] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [projectRootDraft, setProjectRootDraft] = useState("");
  const [serviceDirty, setServiceDirty] = useState(false);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceNotice, setServiceNotice] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [accessKeyBusy, setAccessKeyBusy] = useState(false);
  const [accessKeyNotice, setAccessKeyNotice] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptDirty, setCustomPromptDirty] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptNotice, setPromptNotice] = useState("");
  const navRef = useRef<HTMLElement>(null);

  const loadSystemInfo = useCallback(() => {
    void (async () => {
      try {
        const response = await fetch("/api/system/info", { cache: "no-store" });
        const payload = await response.json() as SystemInfo & { error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "无法读取服务信息。");
        setSystemInfo(payload);
        setSystemInfoError("");
        setPortDraft(String(payload.savedPort));
        setWorkspaceDraft(payload.savedWorkspace);
        setProjectRootDraft(payload.savedProjectWorkspacesRoot);
        setAccessKey(payload.accessKey ?? "");
        setServiceDirty(false);
      } catch (caught) {
        setSystemInfoError(caught instanceof Error ? caught.message : "无法读取服务信息。");
      }
    })();
  }, []);

  useEffect(() => {
    loadSystemInfo();
    void (async () => {
      try {
        const response = await fetch("/api/system-prompt?scope=global", { cache: "no-store" });
        const payload = await response.json() as { global?: unknown; error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "无法读取全局 AGENTS.md。");
        setCustomPrompt(typeof payload.global === "string" ? payload.global : "");
      } catch {
        // 只读失败时不阻塞设置面板。
      }
    })();
  }, [loadSystemInfo]);

  const saveServiceConfig = () => {
    setServiceSaving(true);
    setServiceNotice("");
    void (async () => {
      try {
        const response = await fetch("/api/system/info", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port: portDraft, workspace: workspaceDraft, projectWorkspacesRoot: projectRootDraft }),
        });
        const payload = await response.json() as { error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "保存失败。");
        setServiceDirty(false);
        setServiceNotice("已保存，重启服务后生效。");
        loadSystemInfo();
      } catch (caught) {
        setServiceNotice(caught instanceof Error ? caught.message : "保存失败。");
      } finally {
        setServiceSaving(false);
      }
    })();
  };

  const copyAccessKey = () => {
    if (!accessKey) return;
    void copyTextToClipboard(accessKey).then(() => setAccessKeyNotice("已复制密钥。"), () => setAccessKeyNotice("复制失败，请重试。"));
  };

  const regenerateAccessKey = () => {
    setAccessKeyBusy(true);
    setAccessKeyNotice("");
    void (async () => {
      try {
        const response = await fetch("/api/auth/regenerate", { method: "POST" });
        const payload = await response.json() as { key?: unknown; error?: { message?: unknown } };
        if (!response.ok || typeof payload.key !== "string" || !payload.key) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "重新生成密钥失败。");
        setAccessKey(payload.key);
        try { localStorage.setItem(ACCESS_KEY_STORAGE, payload.key); } catch { /* 隐私模式 */ }
        const loginResponse = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: payload.key }),
        });
        if (!loginResponse.ok) throw new Error("新密钥已生成，但当前浏览器未能重新登录。");
        setAccessKeyNotice("已更新，其他设备需用新密钥重新登录。");
      } catch (caught) {
        setAccessKeyNotice(caught instanceof Error ? caught.message : "重新生成密钥失败。");
      } finally {
        setAccessKeyBusy(false);
      }
    })();
  };

  const saveCustomPrompt = () => {
    setSavingPrompt(true);
    setPromptNotice("");
    void (async () => {
      try {
        const response = await fetch("/api/system-prompt?scope=global", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ global: customPrompt }),
        });
        const payload = await response.json() as { error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "保存失败。");
        setCustomPromptDirty(false);
        setPromptNotice("已保存，新消息立即生效。");
      } catch (caught) {
        setPromptNotice(caught instanceof Error ? caught.message : "保存失败。");
      } finally {
        setSavingPrompt(false);
      }
    })();
  };

  const patch = (partial: Partial<WorkbenchSettings>) => setSettings(partial);

  const selectSection = useCallback((next: SettingsSectionId) => {
    setSectionId(next);
  }, []);

  const onNavKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const currentIndex = sections.findIndex((item) => item.id === sectionId);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + sections.length) % sections.length;
    setSectionId(sections[nextIndex].id);
    navRef.current?.querySelectorAll<HTMLButtonElement>("button")[nextIndex]?.focus();
  };

  const portPending = systemInfo ? Number(systemInfo.port) !== (systemInfo.savedPort) : false;
  const workspacePending = systemInfo ? systemInfo.workspace !== systemInfo.savedWorkspace : false;
  const projectRootPending = systemInfo ? systemInfo.projectWorkspacesRoot !== systemInfo.savedProjectWorkspacesRoot : false;
  const lanAddresses = systemInfo?.lanAddresses ?? [];

  return <div className="global-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="global-settings-modal" role="dialog" aria-modal="true" aria-labelledby="global-settings-heading">
      <header><div><p>工作台</p><h2 id="global-settings-heading">全局设置</h2></div><button type="button" onClick={onClose} aria-label="关闭全局设置">×</button></header>
      <div className="global-settings-body">
        <nav className="global-settings-nav" aria-label="设置分类" ref={navRef} onKeyDown={onNavKeyDown}>
          {sections.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={sectionId === item.id} aria-controls={`settings-pane-${item.id}`} className={sectionId === item.id ? "selected" : ""} onClick={() => selectSection(item.id)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div id="settings-pane-system" role="tabpanel" className="global-settings-pane" hidden={sectionId !== "system"}>
          <h3>系统</h3>
          {systemInfoError ? <p className="settings-note error" role="alert">{systemInfoError}</p> : null}

          <section className="settings-section-block" aria-label="服务">
            <h4>服务</h4>
            <div className="settings-row">
              <div><strong>服务端口</strong></div>
              <div className="settings-field-control">
                <input id="setting-port" className="settings-text-input" type="text" inputMode="numeric" value={portDraft} onChange={(event) => { setPortDraft(event.target.value); setServiceDirty(true); setServiceNotice(""); }} aria-label="服务端口" />
                {portPending ? <span className="settings-pending">重启后生效</span> : null}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>本机访问</strong></div>
              <div className="settings-value"><code>{systemInfo?.localUrl ?? "…"}</code></div>
            </div>
            <div className="settings-row">
              <div><strong>局域网访问</strong></div>
              <div className="settings-value-stack">{lanAddresses.length ? lanAddresses.map((url) => <code key={url}>{url}</code>) : <code>未检测到</code>}</div>
            </div>
          </section>

          <section className="settings-section-block" aria-label="访问密钥">
            <h4>访问密钥</h4>
            <div className="settings-row access-key-row">
              <div><strong>局域网访问密钥</strong><span>用于其他设备登录此工作区</span></div>
              <div className="access-key-control"><code>{accessKey || "…"}</code><button type="button" className="settings-secondary" onClick={copyAccessKey} disabled={!accessKey} aria-label="复制访问密钥" title="复制访问密钥">复制</button><button type="button" className="settings-primary" onClick={regenerateAccessKey} disabled={accessKeyBusy}>{accessKeyBusy ? "生成中…" : "重新生成"}</button></div>
            </div>
            {accessKeyNotice ? <p className={`settings-note${accessKeyNotice.startsWith("已") ? "" : " error"}`} role="status">{accessKeyNotice}</p> : null}
          </section>

          <section className="settings-section-block" aria-label="工作区">
            <h4>工作区</h4>
            <div className="settings-row">
              <div><strong>无项目工作区</strong></div>
              <div className="settings-field-control">
                <input id="setting-workspace" className="settings-text-input" type="text" value={workspaceDraft} onChange={(event) => { setWorkspaceDraft(event.target.value); setServiceDirty(true); setServiceNotice(""); }} aria-label="无项目工作区" spellCheck={false} />
                {workspacePending ? <span className="settings-pending">重启后生效</span> : null}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>项目工作区</strong></div>
              <div className="settings-field-control">
                <input id="setting-project-root" className="settings-text-input" type="text" value={projectRootDraft} onChange={(event) => { setProjectRootDraft(event.target.value); setServiceDirty(true); setServiceNotice(""); }} aria-label="项目工作区" spellCheck={false} />
                {projectRootPending ? <span className="settings-pending">重启后生效</span> : null}
              </div>
            </div>
            <div className="settings-card-actions">
              <span className={`settings-note${serviceNotice.startsWith("已保存") ? "" : " error"}`} role={serviceNotice ? "status" : undefined}>{serviceNotice}</span>
              <button type="button" className="settings-primary" disabled={!serviceDirty || serviceSaving} onClick={saveServiceConfig}>{serviceSaving ? "保存中…" : "保存"}</button>
            </div>
          </section>

          <section className="settings-section-block" aria-label="全局 AGENTS 指令">
            <h4>全局 AGENTS 指令</h4>
            <p className="settings-section-hint">直接编辑 <code>~\.pi\agent\AGENTS.md</code>；Pi 会将它作为全局指令应用到所有项目和会话。保存后新消息立即生效。</p>
            <div className="settings-card-actions">
              <span className={`settings-note${promptNotice.startsWith("已保存") ? "" : " error"}`} role={promptNotice ? "status" : undefined}>{promptNotice}</span>
              <button type="button" className="settings-primary" onClick={() => setPromptEditorOpen(true)}>打开编辑器</button>
            </div>
          </section>

          <section className="settings-section-block" aria-label="关于">
            <h4>关于</h4>
            <div className="settings-row"><div><strong>版本</strong></div><div className="settings-value"><code>v{systemInfo?.version ?? "…"}</code></div></div>
            <div className="settings-row"><div><strong>当前监听</strong></div><div className="settings-value"><code>{systemInfo ? `${systemInfo.host}:${systemInfo.port}` : "…"}</code></div></div>
          </section>
        </div>

        <div id="settings-pane-appearance" role="tabpanel" className="global-settings-pane" hidden={sectionId !== "appearance"}>
          <h3>外观和布局</h3>
          <div className="settings-row"><div><strong>界面主题</strong><span>工作台整体配色</span></div><Segmented options={themes} value={theme} onChange={(next) => setTheme(next, { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) })} ariaLabel="界面主题" /></div>
          <div className="settings-row"><div><strong>整体字体风格</strong><span>全局字体族，代码块不受影响</span></div><Segmented options={fontStyles} value={settings.fontStyle} onChange={(next) => patch({ fontStyle: next })} ariaLabel="整体字体风格" /></div>
          <div className="settings-row"><div><strong>聊天区正文字号</strong><span>消息、标题等正文大小</span></div><Segmented options={[{ value: 13, label: "13" }, { value: 14, label: "14" }, { value: 15, label: "15" }]} value={settings.bodyFontSize} onChange={(next) => patch({ bodyFontSize: next })} ariaLabel="聊天区正文字号" /></div>
          <div className="settings-row"><div><strong>输入框字号</strong><span>任务输入框文字大小</span></div><Segmented options={[{ value: 14, label: "14" }, { value: 16, label: "16" }, { value: 18, label: "18" }]} value={settings.inputFontSize} onChange={(next) => patch({ inputFontSize: next })} ariaLabel="输入框字号" /></div>
          <div className="settings-row"><div><strong>侧栏状态记忆</strong><span>左右侧栏收起/展开状态跨刷新保持</span></div><span className="settings-fixed">自动</span></div>
        </div>

        <div id="settings-pane-session" role="tabpanel" className="global-settings-pane" hidden={sectionId !== "session"}>
          <h3>默认会话行为</h3>
          <div className="settings-row">
            <div><strong>默认模型</strong><span>新建会话时自动选择</span></div>
            <select className="settings-select" aria-label="默认模型" value={settings.defaultModel} onChange={(event) => patch({ defaultModel: event.target.value })}>
              <option value="">跟随上次使用</option>
              {models.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>{model.name}（{model.provider}）</option>)}
            </select>
          </div>
          <div className="settings-row">
            <div><strong>默认思考强度</strong><span>新建会话的初始思考级别</span></div>
            <select className="settings-select" aria-label="默认思考强度" value={settings.defaultThinkingLevel} onChange={(event) => patch({ defaultThinkingLevel: event.target.value as ThinkingLevel | "" })}>
              {thinkingLevels.map((level) => <option key={level.value || "auto"} value={level.value}>{level.label}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <div><strong>自动重试</strong><span>服务暂态错误（如 503）时由 Pi 自动重试</span></div>
            <button type="button" role="switch" aria-checked={settings.autoRetry} className={`settings-switch${settings.autoRetry ? " on" : ""}`} onClick={() => patch({ autoRetry: !settings.autoRetry })}><i aria-hidden="true" /><span>{settings.autoRetry ? "开" : "关"}</span></button>
          </div>
          <div className="settings-row">
            <div><strong>执行完成提醒</strong><span>每次任务结束后弹出提示；切到后台时改用系统通知</span></div>
            <Segmented options={completionAlertOptions} value={settings.completionAlert} onChange={(next) => patch({ completionAlert: next })} ariaLabel="执行完成提醒" />
          </div>
        </div>
      </div>
      <footer><button type="button" className="modal-cancel" onClick={onClose}>关闭</button></footer>
    </section>
    {promptEditorOpen ? <PromptFileEditorDialog
      ariaLabel="全局 AGENTS 指令"
      dirty={customPromptDirty}
      eyebrow="全局指令文件"
      fileName="~/.pi/agent/AGENTS.md"
      notice={promptNotice}
      onChange={(value) => { setCustomPrompt(value); setCustomPromptDirty(true); setPromptNotice(""); }}
      onClose={() => setPromptEditorOpen(false)}
      onSave={saveCustomPrompt}
      placeholder={"在这里编辑全局 AGENTS.md，例如：\n- 总是使用中文回复\n- 优先给出可直接运行的命令\n- …"}
      saving={savingPrompt}
      title="编辑全局 AGENTS.md"
      value={customPrompt}
    /> : null}
  </div>;
}
