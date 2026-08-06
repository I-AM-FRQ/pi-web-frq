/** 复制到剪贴板：非安全上下文（LAN 的 http 地址）下 navigator.clipboard 不可用，降级到 execCommand。 */
export function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand("copy");
      if (ok) resolve();
      else reject(new Error("复制失败。"));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("复制失败。"));
    } finally {
      document.body.removeChild(textarea);
    }
  });
}
