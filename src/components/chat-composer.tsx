"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { findMentionQuery, formatFileReference, insertFileReference } from "@/client/file-references";
import { useWorkspaceFileSearch } from "@/client/use-workspace-file-search";
import { FileMentionMenu } from "@/components/file-mention-menu";
import { SLASH_COMMANDS, SlashCommandMenu, type SlashCommand } from "@/components/slash-command-menu";
import { THINKING_NAMES, ThinkingSlider, type ThinkingSelection } from "@/components/thinking-slider";
import type { ChatImage, ModelDescriptor, ThinkingLevel } from "@/contracts";

/** 解析输入框中已完成的斜杠命令（含可选参数）；非命令或未知命令返回 null。 */
function parseSlashLine(text: string): { command: SlashCommand; argument: string } | null {
  if (text.includes("\n")) return null;
  const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const command = SLASH_COMMANDS.find((item) => item.name === match[1].toLowerCase());
  if (!command) return null;
  return { command, argument: (match[2] ?? "").trim() };
}

/** 网格方向键导航：左右同行移动，上下换行移动；目标项不存在时停留在原处。 */
function moveCommandIndex(current: number, count: number, dx: number, dy: number, columns: number): number {
  if (count <= 1) return 0;
  const rows = Math.ceil(count / columns);
  const row = Math.floor(current / columns);
  const col = current % columns;
  const nextRow = (row + dy + rows) % rows;
  const nextCol = (col + dx + columns) % columns;
  const next = nextRow * columns + nextCol;
  return next < count ? next : current;
}
import type { WorkspaceFileMatch } from "@/workspace-contracts";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set<ChatImage["mimeType"]>(["image/jpeg", "image/png", "image/webp"]);

type DraftImage = ChatImage & { id: string; previewUrl: string };

let draftImageSequence = 0;

function nextDraftImageId() {
  draftImageSequence += 1;
  return `image-${Date.now()}-${draftImageSequence}`;
}

type ChatComposerProps = {
  value: string;
  projectId: string | null;
  models: ModelDescriptor[];
  modelKey: string;
  onModelChange: (modelKey: string) => void;
  thinkingLevel: ThinkingSelection;
  thinkingLevels: ThinkingLevel[];
  recommendedThinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (thinkingLevel: ThinkingSelection) => void;
  onOpenGlobalSettings: () => void;
  onOpenSystemPrompt: () => void;
  disabled: boolean;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onSubmit: (images: ChatImage[], behavior: "steer" | "followUp") => boolean;
  onCommand: (command: SlashCommand, argument: string) => Promise<boolean>;
  onStop: () => void;
  stopping?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

function readImage(file: File): Promise<DraftImage> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.has(file.type as ChatImage["mimeType"])) return reject(new Error("仅支持 PNG、JPEG 或 WebP 图片。"));
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return reject(new Error("每张图片不得超过 5 MiB。"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("无法读取图片。"));
      const marker = `data:${file.type};base64,`;
      if (!reader.result.startsWith(marker)) return reject(new Error("图片数据无效。"));
      resolve({ id: nextDraftImageId(), type: "image", mimeType: file.type as ChatImage["mimeType"], data: reader.result.slice(marker.length), previewUrl: reader.result });
    };
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({ value, projectId, models, modelKey, onModelChange, thinkingLevel, thinkingLevels, recommendedThinkingLevel, onThinkingLevelChange, onOpenGlobalSettings, onOpenSystemPrompt, disabled, isStreaming, onChange, onSubmit, onCommand, onStop, stopping, inputRef }: ChatComposerProps) {
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = inputRef ?? localInputRef;
  const [cursor, setCursor] = useState(value.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [imageError, setImageError] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [steerMode, setSteerMode] = useState<"steer" | "followUp">("followUp");
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const thinkingOptions: ThinkingLevel[] = thinkingLevels.length ? thinkingLevels : ["off"];
  const selectedModel = models.find((model) => `${model.provider}:${model.id}` === modelKey);
  const modelGroups = useMemo(() => {
    const grouped = new Map<string, ModelDescriptor[]>();
    for (const model of models) {
      const group = grouped.get(model.provider) ?? [];
      group.push(model);
      grouped.set(model.provider, group);
    }
    return Array.from(grouped, ([provider, providerModels]) => ({
      provider,
      models: providerModels.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    })).sort((left, right) => left.provider.localeCompare(right.provider, "zh-CN"));
  }, [models]);
  const mention = menuOpen ? findMentionQuery(value, cursor) : null;
  const search = useWorkspaceFileSearch(mention?.query ?? "", projectId);
  // 面板只在“仅命令名、无参数”时出现；选择后由 commandMenuDismissed 关闭，再次回车直接发送。
  const commandMatch = /^\/([A-Za-z0-9_-]*)$/.exec(value);
  const commandQuery = commandMatch?.[1] ?? "";
  const commandVisible = !disabled && !isStreaming && !commandMenuDismissed && Boolean(commandMatch);
  const commandOptions = SLASH_COMMANDS.filter((command) => command.name.startsWith(commandQuery.toLowerCase()));
  const menuVisible = Boolean(mention);

  const updateCursor = (target: HTMLTextAreaElement) => setCursor(target.selectionStart ?? 0);
  const selectMatch = (match: WorkspaceFileMatch) => {
    const target = textareaRef.current;
    const insertion = insertFileReference(value, target?.selectionStart ?? cursor, formatFileReference(match.path));
    onChange(insertion.value);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
      setCursor(insertion.selectionStart);
    });
  };
  const addFiles = async (files: File[]) => {
    if (disabled || files.length === 0) return;
    const available = MAX_IMAGES - images.length;
    if (available <= 0) {
      setImageError(`最多可附加 ${MAX_IMAGES} 张图片。`);
      return;
    }
    const selected = files.slice(0, available);
    try {
      const next = await Promise.all(selected.map(readImage));
      setImages((current) => [...current, ...next]);
      setImageError(files.length > available ? `最多可附加 ${MAX_IMAGES} 张图片。` : "");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "无法添加图片。" );
    }
  };
  const removeImage = (id: string) => {
    setImages((current) => current.filter((image) => image.id !== id));
    setImageError("");
  };
  const chooseCommand = (command: SlashCommand) => {
    onChange(`/${command.name}${command.acceptsArgument ? " " : ""}`);
    setCursor(command.name.length + (command.acceptsArgument ? 2 : 1));
    setCommandMenuDismissed(true);
    setMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const runCommand = async (command: SlashCommand, argument: string) => {
    const completed = await onCommand(command, argument);
    if (completed) {
      onChange("");
      setCursor(0);
      setCommandMenuDismissed(false);
    } else {
      // 失败时保留命令文本，并保持面板关闭，便于直接回车重试。
      setCommandMenuDismissed(true);
    }
    return completed;
  };
  const submit = (event?: FormEvent, explicitValue?: string) => {
    event?.preventDefault();
    const text = explicitValue ?? value;
    // 1) 命令面板打开：选择当前命令，放入输入框并关闭面板，不发送。
    if (commandVisible && commandOptions.length > 0) {
      chooseCommand(commandOptions[commandIndex]);
      return;
    }
    // 2) 输入框已是完整命令：发送执行。
    const slash = parseSlashLine(text);
    if (slash) {
      void runCommand(slash.command, slash.argument);
      return;
    }
    // 3) 文件引用菜单：选择匹配项。
    if (menuVisible && search.matches[activeIndex]) return selectMatch(search.matches[activeIndex]);
    // 4) 普通任务发送。
    if (onSubmit(images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })), steerMode)) {
      setImages([]);
      setImageError("");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 使用 DOM 实时值而非可能滞后的 state，避免中文输入法合成期间命令面板延迟出现。
    const rawValue = event.currentTarget.value;
    const rawCommandMatch = /^\/([A-Za-z0-9_-]*)$/.exec(rawValue);
    const rawCommandQuery = rawCommandMatch?.[1] ?? "";
    const rawCommandOptions = rawCommandMatch ? SLASH_COMMANDS.filter((command) => command.name.startsWith(rawCommandQuery.toLowerCase())) : [];
    const rawCommandVisible = !disabled && !isStreaming && !commandMenuDismissed && rawCommandOptions.length > 0;
    if (menuVisible) {
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, Math.max(search.matches.length - 1, 0))); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); return; }
      if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key === "Enter" && !event.shiftKey && search.matches[activeIndex]) { event.preventDefault(); selectMatch(search.matches[activeIndex]); return; }
    }
    if (rawCommandVisible) {
      const safeIndex = commandIndex % rawCommandOptions.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const columns = window.innerWidth < 980 ? 1 : 3;
        const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        setCommandIndex((current) => moveCommandIndex(current, rawCommandOptions.length, dx, dy, columns));
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); onChange(""); setCursor(0); setCommandMenuDismissed(false); return; }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") { event.preventDefault(); chooseCommand(rawCommandOptions[safeIndex]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(undefined, rawValue); }
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    const images = imageItems.flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    const files = images.length ? images : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  };
  const chooseModel = (nextModelKey: string) => {
    onModelChange(nextModelKey);
    setModelMenuOpen(false);
  };

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // 高度由 value 驱动：输入变化时重新计算。不用 ResizeObserver，
    // 避免“改高度→观察器拉回”的锁死循环。
    const styles = window.getComputedStyle(textarea);
    const minHeight = Number.parseFloat(styles.minHeight) || 0;
    const maxHeight = Number.parseFloat(styles.maxHeight) || Number.POSITIVE_INFINITY;
    let height: number;
    if (textarea.value.trim() === "") {
      // 空输入：直接取 CSS min-height（手机 50px 一行 / 桌面 104px 多行），
      // 不受 rows/UA 固有 scrollHeight 虚高影响。
      height = minHeight;
    } else {
      textarea.style.height = "auto";
      height = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    }
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = "auto";
  }, [textareaRef, value]);

  useEffect(() => {
    if (!modelMenuOpen && !thinkingMenuOpen && !moreOpen) return;
    const closeMenus = () => { setModelMenuOpen(false); setThinkingMenuOpen(false); setMoreOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const inside = modelMenuRef.current?.contains(event.target as Node) || thinkingMenuRef.current?.contains(event.target as Node) || moreMenuRef.current?.contains(event.target as Node);
      if (!inside) closeMenus();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen, moreOpen, thinkingMenuOpen]);

  return (
    <form className="composer" onSubmit={submit}>
      <input ref={fileInputRef} className="sr-only" id="image-upload" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onFileChange} disabled={disabled || isStreaming} />
      <label className="sr-only" htmlFor="chat-input">输入任务</label>
      {images.length ? <div className="image-drafts" aria-label="待发送图片">{images.map((image) => <div className="image-draft" key={image.id}><Image src={image.previewUrl} alt="待发送图片" fill sizes="72px" unoptimized /><button type="button" onClick={() => removeImage(image.id)} aria-label="移除图片">×</button></div>)}</div> : null}
      {imageError ? <p className="image-error" role="alert">{imageError}</p> : null}
      <div className="composer-input-wrap" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <textarea
          ref={textareaRef}
          id="chat-input"
          value={value}
          onChange={(event) => { onChange(event.target.value); updateCursor(event.target); setMenuOpen(Boolean(findMentionQuery(event.target.value, event.target.selectionStart ?? 0))); setActiveIndex(0); setCommandIndex(0); setCommandMenuDismissed(false); }}
          onClick={(event) => { updateCursor(event.currentTarget); setMenuOpen(Boolean(findMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart ?? 0))); }}
          onKeyUp={(event) => updateCursor(event.currentTarget)}
          onKeyDown={onKeyDown}
          onCompositionEnd={(event) => {
            const target = event.currentTarget;
            if (target.value !== value) onChange(target.value);
            updateCursor(target);
            setCommandIndex(0);
            setCommandMenuDismissed(false);
          }}
          onPaste={onPaste}
          onBlur={() => window.setTimeout(() => setMenuOpen(false), 120)}
          aria-autocomplete="list"
          aria-controls={commandVisible && commandOptions.length > 0 ? "slash-command-menu" : menuVisible ? "file-mention-menu" : undefined}
          aria-activedescendant={commandVisible && commandOptions[commandIndex] ? `slash-command-${commandIndex}` : menuVisible && search.matches[activeIndex] ? `file-mention-${activeIndex}` : undefined}
          placeholder="描述任务 · @ 引用文件 · Ctrl V 粘贴图片 · Enter 发送"
          rows={1}
          disabled={disabled}
        />
        {commandVisible && commandOptions.length > 0 ? <SlashCommandMenu commands={commandOptions} activeIndex={commandIndex} onSelect={chooseCommand} /> : menuVisible ? <FileMentionMenu {...search} activeIndex={activeIndex} onSelect={selectMatch} /> : null}
      </div>
      <div className="composer-actions">
        <div className="composer-hints"><div className="composer-model" ref={modelMenuRef}><button type="button" className="composer-model-settings composer-desktop-only" onClick={() => { setModelMenuOpen(false); onOpenGlobalSettings(); }} disabled={disabled || isStreaming} aria-label="打开全局设置" title="全局设置"><svg className="composer-model-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.4 3.2h5.2l.6 2.1c.5.2 1 .5 1.5.9l2.1-.5 2.6 4.5-1.6 1.5v1.7l1.6 1.5-2.6 4.5-2.1-.5c-.5.4-1 .7-1.5.9l-.6 2.1H9.4l-.6-2.1c-.5-.2-1-.5-1.5-.9l-2.1.5-2.6-4.5 1.6-1.5v-1.7l-1.6-1.5 2.6-4.5 2.1.5c.5-.4 1-.7 1.5-.9l.6-2.1ZM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z" /></svg></button><button type="button" className="composer-model-trigger" onClick={() => { setThinkingMenuOpen(false); setMoreOpen(false); setModelMenuOpen((open) => !open); }} disabled={disabled || models.length === 0} aria-label="选择模型" aria-expanded={modelMenuOpen} aria-haspopup="listbox"><span className="composer-model-label">{selectedModel?.name ?? (models.length ? "选择模型" : "模型不可用")}</span></button>{modelMenuOpen ? <div className="composer-model-menu" role="listbox" aria-label="选择模型">{modelGroups.map((group) => <section key={group.provider} className="composer-model-group"><h3>{group.provider.toUpperCase()}</h3>{group.models.map((model) => { const nextModelKey = `${model.provider}:${model.id}`; return <button key={nextModelKey} type="button" role="option" aria-selected={nextModelKey === modelKey} className={nextModelKey === modelKey ? "selected" : ""} onClick={() => chooseModel(nextModelKey)}>{model.name}</button>; })}</section>)}</div> : null}</div><div className="composer-thinking" ref={thinkingMenuRef}><button type="button" className="composer-thinking-trigger" onClick={() => { setModelMenuOpen(false); setMoreOpen(false); setThinkingMenuOpen((open) => !open); }} disabled={disabled || thinkingLevels.length === 0} aria-label="思考强度" aria-expanded={thinkingMenuOpen} aria-haspopup="listbox"><span>思考</span><span className="composer-thinking-value">{thinkingLevel === "auto" ? "自动" : THINKING_NAMES[thinkingLevel]}</span></button>{thinkingMenuOpen ? <ThinkingSlider level={thinkingLevel} options={thinkingOptions} recommended={recommendedThinkingLevel} onChange={onThinkingLevelChange} /> : null}</div><button className="composer-attach composer-desktop-only" type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || isStreaming} aria-label="添加图片" title="添加图片">＋</button></div>
        <div className="composer-more composer-mobile-only" ref={moreMenuRef}><button type="button" className="composer-more-toggle" onClick={() => { setModelMenuOpen(false); setThinkingMenuOpen(false); setMoreOpen((open) => !open); }} disabled={disabled} aria-label="更多操作" title="更多操作" aria-expanded={moreOpen}><span aria-hidden="true">⋯</span></button>{moreOpen ? <div className="composer-more-menu" role="menu" aria-label="更多操作"><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }} disabled={disabled || isStreaming}><span aria-hidden="true">＋</span>添加图片</button><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenGlobalSettings(); }} disabled={disabled || isStreaming}><span aria-hidden="true">⚙</span>全局设置</button><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onOpenSystemPrompt(); }} disabled={disabled || isStreaming}><span aria-hidden="true">❐</span>项目提示词</button></div> : null}</div>
        {isStreaming ? <div className="composer-steer"><div className="steer-mode-toggle" role="radiogroup" aria-label="执行中消息处理方式"><button type="button" role="radio" aria-checked={steerMode === "steer"} className={steerMode === "steer" ? "selected" : ""} onClick={() => setSteerMode("steer")}>引导</button><button type="button" role="radio" aria-checked={steerMode === "followUp"} className={steerMode === "followUp" ? "selected" : ""} onClick={() => setSteerMode("followUp")}>排队</button></div><button className="send-button" type="submit" aria-label={steerMode === "steer" ? "引导" : "发送"} title={steerMode === "steer" ? "引导" : "发送"}><span aria-hidden="true">↑</span></button><button className="stop-button" type="button" onClick={onStop} disabled={stopping} aria-label="停止生成">{stopping ? "停止中…" : "停止"}</button></div> : <div className="composer-submit-actions"><button className="system-prompt-button composer-desktop-only" type="button" onClick={onOpenSystemPrompt} disabled={disabled || isStreaming} aria-label="查看项目系统提示词" title="查看项目系统提示词"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h10.5A2.5 2.5 0 0 1 18 6v14.5L13.5 18 9 20.5V6A2.5 2.5 0 0 0 6.5 3.5H5Z" /><path d="M6 3.5A2.5 2.5 0 0 1 8.5 6v14.5" /></svg></button><button className="send-button" type="submit" aria-label="发送任务">发送 <span aria-hidden="true">↑</span></button></div>}
      </div>
    </form>
  );
}
