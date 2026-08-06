"use client";

import { useEffect, useState } from "react";
import { PromptFileEditorDialog } from "@/components/prompt-file-editor-dialog";

type SystemPromptModalProps = {
  projectId: string | null;
  onClose: () => void;
};

export function SystemPromptModal({ projectId, onClose }: SystemPromptModalProps) {
  const [name, setName] = useState("");
  const [projectPrompt, setProjectPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const response = await fetch(`/api/system-prompt${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { name?: unknown; projectPrompt?: unknown; error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "无法读取项目提示词。");
        if (!controller.signal.aborted) {
          setName(typeof payload.name === "string" ? payload.name : "默认工作区");
          setProjectPrompt(typeof payload.projectPrompt === "string" ? payload.projectPrompt : "");
          setLoading(false);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setNotice(caught instanceof Error ? caught.message : "无法读取项目提示词。");
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [projectId]);

  const save = () => {
    setSaving(true);
    setNotice("");
    void (async () => {
      try {
        const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const response = await fetch(`/api/system-prompt${params}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPrompt }),
        });
        const payload = await response.json() as { error?: { message?: unknown } };
        if (!response.ok) throw new Error(typeof payload.error?.message === "string" ? payload.error.message : "保存失败。");
        setDirty(false);
        setNotice("已保存，新消息立即生效。");
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : "保存失败。");
      } finally {
        setSaving(false);
      }
    })();
  };

  return <PromptFileEditorDialog
    ariaLabel="项目提示词"
    dirty={dirty}
    eyebrow={name ? `项目专属指令 · ${name}` : "默认工作区专属指令"}
    fileName=".pi-web/project-system-prompt.md"
    loading={loading}
    notice={notice}
    onChange={(value) => { setProjectPrompt(value); setDirty(true); setNotice(""); }}
    onClose={onClose}
    onSave={save}
    placeholder="为当前项目添加专属指令…"
    saving={saving}
    title="编辑项目提示词"
    value={projectPrompt}
  />;
}
