import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ConversationItem } from "../contracts";
import { visibleWorkspacePrompt } from "./file-references";
import { redactLocalPaths } from "./output-sanitization";

const TOOL_LABELS: Record<string, string> = {
  workspace_read: "读取文件",
  workspace_list: "列出目录",
  workspace_find: "搜索文件",
  workspace_grep: "搜索内容",
  workspace_write: "写入文件",
  workspace_edit: "编辑文件",
  bash: "执行命令",
};

/** 生成工具步骤的展示文本，例如「读取文件 · src/app.ts」或「bash · npm test」。 */
export function toolStepLabel(name: string, args: unknown): string {
  const label = TOOL_LABELS[name] ?? name;
  if (args === undefined || args === null || typeof args !== "object") return label;
  const record = args as Record<string, unknown>;
  let detail = "";
  if (typeof record.path === "string") detail = record.path;
  else if (typeof record.command === "string") detail = record.command;
  else if (typeof record.query === "string") detail = record.query;
  else if (typeof record.pattern === "string") detail = record.pattern;
  else {
    try {
      detail = JSON.stringify(args);
    } catch {
      detail = "";
    }
  }
  if (!detail) return label;
  return detail.length > 140 ? `${label} · ${detail.slice(0, 140)}…` : `${label} · ${detail}`;
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function structuredText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
      return item;
    }, 2) ?? "";
  } catch {
    return String(value);
  }
}

/** 将 Pi 工具的原始返回转换为可直接查看的文本，优先保留结果内容。 */
export function toolResultText(value: unknown): string {
  if (typeof value === "string" || Array.isArray(value)) return asText(value);
  if (typeof value !== "object" || value === null) return structuredText(value);
  const result = value as { content?: unknown; details?: unknown };
  const content = asText(result.content);
  if (content) return content;
  if (result.details !== undefined) return structuredText(result.details);
  return structuredText(value);
}

export function visibleAssistantText(content: unknown): string {
  const text = asText(content);
  const marker = /<\/?(?:think|thinking|reasoning|analysis)\b[^>]*>/i;
  if (marker.test(text)) {
    const firstMarker = text.search(marker);
    return firstMarker >= 0 ? text.slice(0, firstMarker).trim() : "";
  }
  return text.trim();
}

function timestamp(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

/**
 * 将一条会话分支投影为可显示的对话条目（含思考、工具步骤），并按工具结果回填状态和原始返回。
 * 不显示 compaction 摘要；助手内容分段保留原始发生顺序。
 */
function legacyReplacedUserMessageIds(branch: SessionEntry[]): Set<string> {
  const ids = new Set<string>();
  let previousUser: Extract<SessionEntry, { type: "message" }> | undefined;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "user") {
      // Sessions created before edit branching used the selected user entry as the branch point.
      // That produced adjacent duplicate prompts on the active path; retain only the replacement.
      if (previousUser && asText((previousUser.message as { content?: unknown }).content) === asText((entry.message as { content?: unknown }).content)) ids.add(previousUser.id);
      previousUser = entry;
      continue;
    }
    if (entry.message.role === "assistant" || entry.message.role === "toolResult") previousUser = undefined;
  }
  return ids;
}

export function buildConversationItems(branch: SessionEntry[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const pendingTools = new Map<string, number>();
  const replacedIds = legacyReplacedUserMessageIds(branch);
  let model: { provider: string; id: string } | undefined;

  for (const entry of branch) {
    if (entry.type === "model_change") {
      model = { provider: entry.provider, id: entry.modelId };
      continue;
    }
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message.role === "user") {
      if (replacedIds.has(entry.id)) continue;
      items.push({
        type: "user",
        content: redactLocalPaths(visibleWorkspacePrompt(asText(message.content))),
        timestamp: timestamp(entry.timestamp ?? message.timestamp),
        ...(entry.id ? { id: entry.id } : {}),
      });
      continue;
    }
    if (message.role === "assistant") {
      const messageModel = typeof message.provider === "string" && typeof message.model === "string"
        ? { provider: message.provider, id: message.model }
        : model;
      // 顶层 entry.timestamp 是消息真实完成时间；message.timestamp 在批量写盘时
      // 接近同一批 user 消息（常相差 1-10ms），会导致“思考与执行过程”耗时失真。
      const itemTimestamp = timestamp(entry.timestamp ?? message.timestamp);
      const addAssistantText = (value: unknown) => {
        const text = redactLocalPaths(visibleAssistantText(value));
        if (!text) return;
        items.push({
          type: "assistant",
          content: text,
          timestamp: itemTimestamp,
          isError: Boolean(message.errorMessage),
          ...(messageModel ? { model: messageModel } : {}),
        });
      };

      if (!Array.isArray(message.content)) {
        addAssistantText(message.content);
        continue;
      }

      for (const part of message.content) {
        if (typeof part !== "object" || part === null) continue;
        const typedPart = part as { type?: unknown; thinking?: unknown; text?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
        if (typedPart.type === "thinking" && typeof typedPart.thinking === "string" && typedPart.thinking.trim()) {
          items.push({ type: "thinking", content: redactLocalPaths(typedPart.thinking), timestamp: itemTimestamp });
          continue;
        }
        if (typedPart.type === "text" && typeof typedPart.text === "string") {
          addAssistantText(typedPart.text);
          continue;
        }
        if (typedPart.type === "toolCall" && typeof typedPart.id === "string" && typeof typedPart.name === "string") {
          const item: ConversationItem = {
            type: "tool",
            id: typedPart.id,
            name: typedPart.name,
            label: toolStepLabel(typedPart.name, typedPart.arguments),
            isError: false,
            timestamp: itemTimestamp,
          };
          pendingTools.set(typedPart.id, items.length);
          items.push(item);
        }
      }
      continue;
    }
    if (message.role === "toolResult") {
      const index = pendingTools.get(message.toolCallId);
      if (index !== undefined) {
        const item = items[index];
        if (item && item.type === "tool") {
          item.isError = Boolean(message.isError);
          item.result = toolResultText({ content: message.content, details: message.details });
        }
        pendingTools.delete(message.toolCallId);
      }
      continue;
    }
  }

  return items;
}

export const MAX_SESSION_CONVERSATION_ITEMS = 160;

export function projectSessionConversation(sessionManager: SessionManager, limit = MAX_SESSION_CONVERSATION_ITEMS, entryId?: string, offset = 0) {
  const branch = sessionManager.getBranch(entryId);
  const all = buildConversationItems(branch);
  const maxItems = Math.max(1, limit);
  const endIndex = Math.max(0, all.length - Math.max(0, offset));

  // 每页从一个用户消息开始，确保任务组不被切断；nextOffset 精确指向本页之前的边界。
  let startIndex = Math.max(0, endIndex - maxItems);
  while (startIndex > 0 && all[startIndex].type !== "user") startIndex -= 1;
  const nextOffset = startIndex > 0 ? all.length - startIndex : null;

  return { items: all.slice(startIndex, endIndex), truncated: nextOffset !== null, nextOffset };
}
