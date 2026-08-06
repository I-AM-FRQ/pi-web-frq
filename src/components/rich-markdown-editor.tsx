"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/client/theme";
import {
  BoldItalicUnderlineToggles,
  codeBlockPlugin,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  toolbarPlugin,
  UndoRedo,
  type MDXEditorMethods,
} from "@mdxeditor/editor";

type RichMarkdownEditorProps = {
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

export function RichMarkdownEditor({ ariaLabel, onChange, placeholder, value }: RichMarkdownEditorProps) {
  const { theme } = useTheme();
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastEmittedValue = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedValue.current) {
      editorRef.current?.setMarkdown(value);
      lastEmittedValue.current = value;
    }
  }, [value]);

  return <div className="prompt-rich-editor-shell" role="region" aria-label={ariaLabel}>
    <MDXEditor
      ref={editorRef}
      markdown={value}
      className={`prompt-rich-editor mdxeditor-full-height ${theme === "dark" ? "dark-theme" : "light-theme"}`}
      contentEditableClassName="prompt-rich-editor-content"
    placeholder={placeholder}
    spellCheck={false}
    suppressHtmlProcessing
    plugins={[
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      codeBlockPlugin(),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () => <><UndoRedo /><BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><CodeToggle /><ListsToggle options={["bullet", "number"]} /><CreateLink /><InsertCodeBlock /></>,
      }),
    ]}
      onChange={(markdown) => {
        lastEmittedValue.current = markdown;
        onChange(markdown);
      }}
    />
  </div>;
}
