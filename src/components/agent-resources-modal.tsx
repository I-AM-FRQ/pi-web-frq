"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentResource, AgentResourceKind, AgentResources } from "@/contracts";

type Props = {
  kind: AgentResourceKind;
  onClose: () => void;
  onChanged: (resources: AgentResources) => void;
};

const labels: Record<AgentResourceKind, string> = { skills: "技能", plugins: "插件" };

function emptyResources(): AgentResources {
  return { skills: [], plugins: [], directories: { skills: [], plugins: [] } };
}

export function AgentResourcesModal({ kind, onClose, onChanged }: Props) {
  const [resources, setResources] = useState<AgentResources>(emptyResources);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newName, setNewName] = useState("");
  const [directory, setDirectory] = useState("");
  const entries = resources[kind];
  const selected = useMemo(() => entries.find((item) => item.id === selectedId) ?? null, [entries, selectedId]);

  const apply = useCallback((next: AgentResources) => {
    setResources(next);
    onChanged(next);
  }, [onChanged]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/resources", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json() as AgentResources;
        if (!cancelled) {
          apply(next);
          const items = next[kind];
          setSelectedId((prev) => (items.some((item) => item.id === prev) ? prev : items[0]?.id ?? null));
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? `无法加载${labels[kind]}（${caught.message}）` : `无法加载${labels[kind]}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apply, kind]);

  // 选中资源变化时同步编辑草稿内容；不参与加载 effect 依赖，避免切换选中时重新请求。
  useEffect(() => {
    const timer = window.setTimeout(() => setContent(selected?.content ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, [selected?.content]);

  const saveConfiguration = async (next: AgentResources) => {
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/resources", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skills: next.skills.filter((item) => item.enabled).map((item) => item.id),
          plugins: next.plugins.filter((item) => item.enabled).map((item) => item.id),
          forcedSkills: next.skills.filter((item) => item.enabled && item.mode === "force").map((item) => item.id),
          directories: next.directories,
        }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
      apply(await response.json() as AgentResources);
      setNotice("已保存并同步到 TUI（pi 命令行）配置；TUI 内执行 /reload 立即生效。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法保存资源配置。");
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = (resource: AgentResource) => {
    const next: AgentResources = {
      ...resources,
      [kind]: entries.map((item) => {
        if (item.id !== resource.id) return item;
        const enabled = !item.enabled;
        // 停用时同步取消强制注入；启用时默认“仅注册”（省 token）。
        return { ...item, enabled, ...(item.kind === "skills" ? { mode: enabled ? (item.mode === "force" ? "force" : "register") : undefined } : {}) };
      }),
    };
    void saveConfiguration(next);
  };

  const toggleForce = (resource: AgentResource) => {
    if (resource.kind !== "skills" || !resource.enabled) return;
    const next: AgentResources = {
      ...resources,
      skills: resources.skills.map((item) => item.id === resource.id ? { ...item, mode: item.mode === "force" ? "register" : "force" } : item),
    };
    void saveConfiguration(next);
  };

  const addDirectory = () => {
    const path = directory.trim();
    if (!path) return;
    void saveConfiguration({
      ...resources,
      directories: { ...resources.directories, [kind]: [...new Set([...resources.directories[kind], path])] },
    });
    setDirectory("");
  };

  const removeDirectory = (path: string) => {
    void saveConfiguration({
      ...resources,
      directories: { ...resources.directories, [kind]: resources.directories[kind].filter((item) => item !== path) },
    });
  };

  const saveContent = async () => {
    if (!selected) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/resources/${kind}/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
      apply(await response.json() as AgentResources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法保存资源内容。");
    } finally {
      setIsSaving(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
      const next = await response.json() as AgentResources;
      apply(next);
      setSelectedId(name);
      setNewName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法创建资源。");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`删除${labels[kind]}“${selected.name}”？`)) return;
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/resources/${kind}/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
      apply(await response.json() as AgentResources);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法删除资源。");
    } finally {
      setIsSaving(false);
    }
  };

  return <div className="resource-config-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="resource-config-modal" role="dialog" aria-modal="true" aria-labelledby="resource-config-heading">
      <header><div><p>运行资源</p><h2 id="resource-config-heading">{labels[kind]}</h2></div><button type="button" onClick={onClose} aria-label={`关闭${labels[kind]}配置`}>×</button></header>
      <div className="resource-config-body">
        <aside>
          <div className="resource-create"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="resource-name" aria-label={`新${labels[kind]}名称`} /><button type="button" onClick={() => void create()} disabled={isSaving || !newName.trim()}>新增</button></div>
          <section className="resource-directories" aria-label={`${labels[kind]}扫描目录`}><label>扫描目录</label><div><input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="D:\\tools\\resources" aria-label={`添加${labels[kind]}扫描目录`} /><button type="button" onClick={addDirectory} disabled={isSaving || !directory.trim()}>添加</button></div>{resources.directories[kind].map((path) => <p key={path}><code>{path}</code><button type="button" onClick={() => removeDirectory(path)} disabled={isSaving} aria-label={`移除目录 ${path}`}>×</button></p>)}</section>
          <div className="resource-list">
            {isLoading ? <p>正在加载…</p> : null}
            {!isLoading && entries.length === 0 ? <p>尚未创建{labels[kind]}。</p> : null}
            {entries.map((item) => <button key={item.id} type="button" className={item.id === selectedId ? "selected" : ""} onClick={() => { setSelectedId(item.id); setContent(item.content); }}><span className={item.enabled ? "resource-state enabled" : "resource-state"}>{item.enabled ? "启用" : "停用"}</span>{item.kind === "skills" && item.mode === "force" ? <span className="resource-state force">强制</span> : null}<strong>{item.name}</strong><small>{item.origin === "managed" ? "pi-web-frq" : item.origin === "default" ? "默认目录" : "配置目录"} · {item.description}</small></button>)}
          </div>
        </aside>
        <section className="resource-editor">
          {selected ? <>
            <div className="resource-editor-heading"><div><h3>{selected.name}</h3><p>{selected.description}</p></div><label className="resource-toggle"><input type="checkbox" checked={selected.enabled} onChange={() => toggle(selected)} disabled={isSaving} />启用</label>{selected.kind === "skills" && selected.enabled ? <label className="resource-toggle" title="强制注入：全文写入系统提示，常驻每次请求的上下文；仅注册：模型按需读取技能文件（省 Token）"><input type="checkbox" checked={selected.mode === "force"} onChange={() => toggleForce(selected)} disabled={isSaving} />强制注入</label> : null}</div>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} readOnly={!selected.editable} aria-label={`${selected.name} 内容`} />
            <div className="resource-editor-actions">{selected.editable ? <button type="button" className="resource-delete" onClick={() => void remove()} disabled={isSaving}>删除</button> : <span className="resource-readonly">来自扫描目录，只读。</span>}{selected.editable ? <button type="button" className="modal-save" onClick={() => void saveContent()} disabled={isSaving || content === selected.content}>保存内容</button> : null}</div>
          </> : <p className="resource-empty">选择或新增一个{labels[kind]}。</p>}
          {error ? <p className="provider-status error" role="alert">{error}</p> : null}
          {notice ? <p className="provider-status ok" role="status">{notice}</p> : null}
        </section>
      </div>
    </section>
  </div>;
}
