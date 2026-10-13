"use client";

import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyTextToClipboard } from "@/client/clipboard";
import { ImageLightbox } from "@/components/image-lightbox";
import { TextFileModal } from "@/components/text-file-modal";

/** 文本类扩展名：点击后弹模态框用 markdown 渲染，而不是走下载/新窗口。 */
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "txt", "log", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "ini", "env",
  "sh", "bash", "zsh", "ps1", "bat", "cmd", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte",
  "html", "htm", "xml", "css", "scss", "less", "sql", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "rb", "lua", "r", "dart", "gradle", "dockerfile", "gitignore",
]);

function localFilePathFromHref(href: string): string | null {
  const prefix = "/api/local-file?path=";
  if (!href.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(href.slice(prefix.length));
  } catch {
    return null;
  }
}

function isTextPath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? path;
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (TEXT_EXTENSIONS.has(extension)) return true;
  return /^(dockerfile|makefile|readme|license)$/i.test(name);
}

/** 块级代码：右上角复制按钮。 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    void copyTextToClipboard(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="code-block">
      <button type="button" className="code-block-copy" onClick={copy} aria-label="复制代码" title="复制代码">
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const IMAGE_EXTENSIONS = "png|jpe?g|gif|webp|bmp|svg|ico";
/**
 * 绝对/相对图片路径：
 * - Windows 盘符路径（D:\a\b.png）——盘符前必须是词边界，否则会把 https: 里的 s: 误当盘符
 * - Unix 路径（/home/u/a.png）——斜杠前不能是字母数字或另一个斜杠（排除 URL 内部路径）
 */
const LOCAL_IMAGE_PATTERN = new RegExp(
  `(?:(?<![\\w])[A-Za-z]:[\\\\/][^\\s<>"'\`()\\[\\]]+\\.(?:${IMAGE_EXTENSIONS})|(?<![\\w:/])/[^\\s<>"'\`()\\[\\]]+\\.(?:${IMAGE_EXTENSIONS}))`,
  "gi",
);
/** 带扩展名的本地文件路径（用于生成可打开/下载的链接） */
const LOCAL_FILE_PATTERN = new RegExp(
  `(?:(?<![\\w])[A-Za-z]:[\\\\/][^\\s<>"'\`()\\[\\]]+\\.[A-Za-z0-9]{2,6}|(?<![\\w:/])/(?:[^\\s<>"'\`()\\[\\]]+/)*[^\\s<>"'\`()\\[\\]]+\\.[A-Za-z0-9]{2,6})`,
  "gi",
);

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function localFileUrl(path: string): string {
  return `/api/local-file?path=${encodeURIComponent(path)}`;
}

/**
 * 把模型输出里的本地路径转成可直接显示/打开的资源：
 * - 本地图片（D:\a\b.png、/home/u/c.jpg）→ 内联图片
 * - 本地文件（带扩展名）→ 可点击链接（新窗口打开或下载）
 * 已是 markdown 链接/图片的内容先做保护，避免重复处理与误伤。
 */
export function linkifyLocalPaths(content: string): string {
  if (!content) return content;
  const protectedSegments: string[] = [];
  let text = content.replace(/!?\[[^\]]*\]\([^)]*\)/g, (match) => {
    protectedSegments.push(match);
    return `\u0000${protectedSegments.length - 1}\u0000`;
  });

  text = text.replace(LOCAL_IMAGE_PATTERN, (match) => `![${fileNameOf(match)}](${localFileUrl(match)})`);
  text = text.replace(LOCAL_FILE_PATTERN, (match) => {
    if (match.startsWith("/api/")) return match; // 已是本站 API 路径，别二次包装
    return `[${fileNameOf(match)}](${localFileUrl(match)})`;
  });

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => protectedSegments[Number(index)] ?? "");
}

export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  const prepared = useMemo(() => linkifyLocalPaths(content), [content]);
  // 点击图片 → 缩放查看；点击文本类文件链接 → 弹模态框用 markdown 渲染
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [textFilePath, setTextFilePath] = useState<string | null>(null);

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          // 链接：本地文本文件拦截为模态框查看，其余（网页/下载）新窗口打开
          a: ({ href, children }) => {
            const path = typeof href === "string" ? localFilePathFromHref(href) : null;
            if (path && isTextPath(path)) {
              return (
                <button type="button" className="markdown-link markdown-link-file" onClick={() => setTextFilePath(path)} title="点击查看内容">
                  {children}
                </button>
              );
            }
            return (
              <a className="markdown-link" href={typeof href === "string" ? href : undefined} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          // 图片：限宽显示，点击打开缩放查看器
          img: ({ src, alt }) => {
            const source = typeof src === "string" ? src : "";
            return (
              <button type="button" className="markdown-image-button" onClick={() => setLightboxSrc(source)} title="点击查看大图">
                <img className="markdown-image" src={source} alt={alt ?? ""} loading="lazy" />
              </button>
            );
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
      {lightboxSrc ? <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} /> : null}
      {textFilePath ? <TextFileModal path={textFilePath} onClose={() => setTextFilePath(null)} /> : null}
    </div>
  );
});
