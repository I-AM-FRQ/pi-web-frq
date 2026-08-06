"use client";

import { PromptFileEditor } from "@/components/prompt-file-editor";

type PromptFileEditorDialogProps = {
  ariaLabel: string;
  dirty: boolean;
  eyebrow: string;
  fileName: string;
  loading?: boolean;
  notice: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  placeholder?: string;
  saving: boolean;
  title: string;
  value: string;
};

export function PromptFileEditorDialog({ ariaLabel, dirty, eyebrow, fileName, loading = false, notice, onChange, onClose, onSave, placeholder, saving, title, value }: PromptFileEditorDialogProps) {
  return <div className="prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="prompt-editor-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-editor-heading">
      <header><div><p>{eyebrow}</p><h2 id="prompt-editor-heading">{title}</h2></div><button type="button" onClick={onClose} aria-label={`关闭${title}`}>×</button></header>
      <div className="prompt-editor-content">
        <p className="prompt-editor-hint">保存后对所有后续新消息生效（包括已有会话）；但已有会话是否遵循最新指令取决于模型，建议在新会话中验证效果。</p>
        {loading ? <p className="provider-status">正在读取文件…</p> : <PromptFileEditor ariaLabel={ariaLabel} fileName={fileName} value={value} placeholder={placeholder} onChange={onChange} />}
        {notice ? <p className={`settings-note${notice.startsWith("已保存") ? "" : " error"}`} role="status">{notice}</p> : null}
      </div>
      <footer><button type="button" className="modal-cancel" onClick={onClose}>关闭</button><button type="button" className="settings-primary" disabled={loading || !dirty || saving} onClick={onSave}>{saving ? "保存中…" : "保存"}</button></footer>
    </section>
  </div>;
}
