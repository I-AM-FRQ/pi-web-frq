import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { redactLocalPaths } from "./output-sanitization";
import { projectSessionConversation } from "./session-projection";
import { SESSION_ENTRY_ID_PATTERN } from "./session-fork";

const MAX_EXPORT_BYTES = 1024 * 1024;
const MAX_EXPORT_ITEMS = 2_000;
const REDACTED_SECRET = "[敏感内容已隐藏]";

export class SessionExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExportValidationError";
  }
}

export class SessionExportUnsafeContentError extends Error {
  constructor() {
    super("The requested session contains content that cannot be exported safely.");
    this.name = "SessionExportUnsafeContentError";
  }
}

export class SessionExportTooLargeError extends Error {
  constructor() {
    super("The requested session export is too large.");
    this.name = "SessionExportTooLargeError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseSessionExportRequest(value: unknown): string | undefined {
  if (!isPlainObject(value) || !Object.keys(value).every((key) => key === "entryId")) {
    throw new SessionExportValidationError("Request body must contain only an optional entryId.");
  }
  if (value.entryId === undefined) return undefined;
  if (typeof value.entryId !== "string" || !SESSION_ENTRY_ID_PATTERN.test(value.entryId)) {
    throw new SessionExportValidationError("entryId must be an 8-character session entry identifier.");
  }
  return value.entryId;
}

function removeControls(value: string) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\r\n?/g, "\n");
}

function redactSecrets(value: string) {
  return value
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, REDACTED_SECRET)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED_SECRET)
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*([:=])\s*(?:"[^"]{8,}"|'[^']{8,}'|[^\s"']{8,})/gi, `$1$2${REDACTED_SECRET}`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=)[^&#\s]{8,}/gi, `$1${REDACTED_SECRET}`)
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[credentials-hidden]@");
}

function hasUnsafeContent(value: string) {
  const withoutWorkspaceMarker = value.replaceAll("<workspace>", "WORKSPACE");
  const withoutRedactions = withoutWorkspaceMarker.replaceAll(REDACTED_SECRET, "X");
  return /<<<pi-web:|\[Workspace reference:|<\/?(?:think|thinking|reasoning|analysis)\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*([:=])\s*(?:"[^"]{8,}"|'[^']{8,}'|[^\s"']{8,})|[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=[^&#\s]{8,}/i.test(withoutRedactions);
}

function safeText(value: string) {
  const cleaned = redactSecrets(redactLocalPaths(removeControls(value)));
  if (hasUnsafeContent(cleaned)) throw new SessionExportUnsafeContentError();
  return cleaned;
}

export function projectSessionExport(sessionManager: SessionManager, entryId?: string) {
  const sourceEntries = sessionManager.getBranch(entryId);
  if (sourceEntries.length > MAX_EXPORT_ITEMS) throw new SessionExportTooLargeError();

  const { items, truncated } = projectSessionConversation(sessionManager, MAX_EXPORT_ITEMS, entryId);
  if (truncated) throw new SessionExportTooLargeError();

  const sections = items.flatMap((item) => {
    if (item.type === "thinking") return [];
    if (item.type === "tool") return [`工具\n${item.label}${item.isError ? "（失败）" : ""}`];
    if (/<<<pi-web:|\[Workspace reference:|<\/?(?:think|thinking|reasoning|analysis)\b/i.test(item.content)) return [];
    const heading = item.type === "user" ? "用户" : item.isError ? "结果（未完成）" : "结果";
    return [`${heading}\n${safeText(item.content)}`];
  });
  const content = `工作台会话导出\n\n${sections.join("\n\n")}`.trimEnd() + "\n";
  if (Buffer.byteLength(content, "utf8") > MAX_EXPORT_BYTES) throw new SessionExportTooLargeError();
  return content;
}
