"use client";

import { useRef, useState } from "react";
import type { ProviderConfigInput, ProviderConfigSummary } from "@/contracts";

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

function emptyProvider(): ProviderConfigInput {
  return {
    id: "",
    name: "",
    baseUrl: "http://127.0.0.1:8080/v1",
    api: "openai-completions",
    authHeader: true,
    models: [{ id: "", name: "", reasoning: false, acceptsImages: false, contextWindow: 128000, maxTokens: 16384 }],
  };
}

function fromProvider(provider: ProviderConfigSummary): ProviderConfigInput {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api,
    authHeader: provider.authHeader,
    models: provider.models.map((model) => ({ ...model })),
  };
}

function messageFrom(response: Response) {
  return response.json().then((payload: unknown) => typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "object" && payload.error !== null && "message" in payload.error && typeof payload.error.message === "string" ? payload.error.message : `请求失败（HTTP ${response.status}）。`).catch(() => `请求失败（HTTP ${response.status}）。`);
}

type ProviderConfigModalProps = {
  onClose: () => void;
  onChanged: () => void;
};

export function ProviderConfigModal({ onClose, onChanged }: ProviderConfigModalProps) {
  const [providers, setProviders] = useState<ProviderConfigSummary[]>([]);
  const [draft, setDraft] = useState<ProviderConfigInput>(emptyProvider);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const didLoad = useRef(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/models/config", { cache: "no-store" });
      if (!response.ok) throw new Error(await messageFrom(response));
      const payload = await response.json() as { providers?: ProviderConfigSummary[] };
      const next = Array.isArray(payload.providers) ? payload.providers : [];
      setProviders(next);
      if (selectedId) {
        const selected = next.find((provider) => provider.id === selectedId);
        if (selected) setDraft(fromProvider(selected));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取 Provider 配置。");
    } finally {
      setLoading(false);
    }
  };


  const open = async () => {
    await load();
  };

  const selectProvider = (provider: ProviderConfigSummary) => {
    setSelectedId(provider.id);
    setDraft(fromProvider(provider));
    setError("");
  };
  const addProvider = () => {
    setSelectedId(null);
    setDraft(emptyProvider());
    setError("");
  };
  const updateModel = (index: number, field: "id" | "name" | "reasoning" | "acceptsImages" | "contextWindow" | "maxTokens", value: string | boolean) => {
    setDraft((current) => ({ ...current, models: current.models.map((model, modelIndex) => modelIndex === index ? { ...model, [field]: field === "contextWindow" || field === "maxTokens" ? Number(value) : value } : model) }));
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/models/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error(await messageFrom(response));
      const payload = await response.json() as { provider: ProviderConfigSummary };
      setSelectedId(payload.provider.id);
      setDraft(fromProvider(payload.provider));
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法保存 Provider 配置。");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!selectedId || !window.confirm(`删除 Provider “${selectedId}”及其模型配置？`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/models/config/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await messageFrom(response));
      addProvider();
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法删除 Provider 配置。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-config-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="provider-config-modal" role="dialog" aria-modal="true" aria-labelledby="provider-config-heading" ref={() => { if (!didLoad.current) { didLoad.current = true; void open(); } }}>
        <header><div><p>本机模型目录</p><h2 id="provider-config-heading">模型配置</h2></div><button type="button" onClick={onClose} aria-label="关闭模型管理">×</button></header>
        <div className="provider-config-body">
          <aside aria-label="Provider 列表"><div className="provider-list">{providers.map((provider) => <button key={provider.id} type="button" className={selectedId === provider.id ? "selected" : ""} onClick={() => selectProvider(provider)}><strong>{provider.name}</strong><span>{provider.id} · {provider.models.length} 个模型</span></button>)}</div><button className="provider-add" type="button" onClick={addProvider}>＋ 添加 Provider</button></aside>
          <div className="provider-editor">
            <div className="provider-editor-heading"><div><p>{selectedId ? "编辑 Provider" : "新增 Provider"}</p><h3>{draft.name || "未命名 Provider"}</h3></div>{selectedId ? <button type="button" className="provider-delete" onClick={() => { void remove(); }} disabled={saving}>删除</button> : null}</div>
            <div className="provider-form">
              <label>Provider ID<input value={draft.id} disabled={Boolean(selectedId)} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} placeholder="例如 local-llm" autoComplete="off" /></label>
              <label>Provider 名称<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如 Local LLM" autoComplete="off" /></label>
              <label>Base URL<input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="http://127.0.0.1:8080/v1" autoComplete="off" /></label>
              <label>API<select value={draft.api} onChange={(event) => setDraft((current) => ({ ...current, api: event.target.value }))}>{API_OPTIONS.map((api) => <option key={api} value={api}>{api}</option>)}</select></label>
              <label>API Key<input type="password" value={draft.apiKey ?? ""} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value || undefined }))} placeholder={selectedId ? "已配置时留空则保持不变" : "可选"} autoComplete="new-password" /></label>
              <label className="provider-checkbox"><input type="checkbox" checked={draft.authHeader} onChange={(event) => setDraft((current) => ({ ...current, authHeader: event.target.checked }))} />使用 Bearer Authorization</label>
            </div>
            <div className="provider-models"><div><h3>模型</h3><button type="button" onClick={() => setDraft((current) => ({ ...current, models: [...current.models, { id: "", name: "", reasoning: false, acceptsImages: false, contextWindow: 128000, maxTokens: 16384 }] }))}>＋ 添加模型</button></div>{draft.models.map((model, index) => <section key={`${index}-${model.id}`}><button type="button" aria-label={`删除模型 ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, models: current.models.filter((_model, modelIndex) => modelIndex !== index) }))} disabled={draft.models.length === 1}>×</button><label>模型 ID<input value={model.id} onChange={(event) => updateModel(index, "id", event.target.value)} /></label><label>显示名称<input value={model.name} onChange={(event) => updateModel(index, "name", event.target.value)} /></label><label>上下文<input type="number" min="1" value={model.contextWindow} onChange={(event) => updateModel(index, "contextWindow", event.target.value)} /></label><label>最大输出<input type="number" min="1" value={model.maxTokens} onChange={(event) => updateModel(index, "maxTokens", event.target.value)} /></label><label className="provider-checkbox"><input type="checkbox" checked={model.reasoning} onChange={(event) => updateModel(index, "reasoning", event.target.checked)} />支持思考</label><label className="provider-checkbox"><input type="checkbox" checked={model.acceptsImages} onChange={(event) => updateModel(index, "acceptsImages", event.target.checked)} />支持图片</label></section>)}</div>
            {loading ? <p className="provider-status">正在读取配置…</p> : null}{error ? <p className="provider-status error" role="alert">{error}</p> : null}
          </div>
        </div>
        <footer><p>API Key 仅可写入，重新打开时不会显示。</p><button type="button" className="modal-cancel" onClick={onClose}>取消</button><button type="button" className="modal-save" onClick={() => { void save(); }} disabled={saving || loading}>{saving ? "保存中…" : "保存"}</button></footer>
      </section>
    </div>
  );
}
