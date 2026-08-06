"use client";

import dynamic from "next/dynamic";
import "@mdxeditor/editor/style.css";

const RichMarkdownEditor = dynamic(
  () => import("@/components/rich-markdown-editor").then((module) => module.RichMarkdownEditor),
  { ssr: false, loading: () => <p className="provider-status">正在启动所见即所得编辑器…</p> },
);

type PromptFileEditorProps = {
  ariaLabel: string;
  fileName: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

export function PromptFileEditor({ ariaLabel, fileName, onChange, placeholder, value }: PromptFileEditorProps) {
  return <div className="prompt-file-editor">
    <div className="prompt-file-editor-bar"><code>{fileName}</code><span>所见即所得 Markdown 文档</span></div>
    <RichMarkdownEditor ariaLabel={ariaLabel} value={value} placeholder={placeholder} onChange={onChange} />
  </div>;
}
