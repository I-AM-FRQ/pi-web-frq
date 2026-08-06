import type { SessionEntry, SessionManager, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { visibleWorkspacePrompt } from "./file-references";
import { visibleAssistantText } from "./session-projection";
import { redactLocalPaths } from "./output-sanitization";

const MAX_LABEL_LENGTH = 120;
export const MAX_SESSION_TREE_NODES = 160;

export type SafeSessionTreeNode = {
  id: string;
  kind: "user" | "assistant" | "tool" | "summary" | "setting" | "metadata";
  label: string;
  timestamp: string;
  children: SafeSessionTreeNode[];
};

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function timestamp(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

function label(value: string, fallback: string): string {
  const normalized = redactLocalPaths(value).replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > MAX_LABEL_LENGTH ? `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…` : normalized;
}

function projectEntry(entry: SessionEntry): Omit<SafeSessionTreeNode, "children"> {
  if (entry.type === "message") {
    const message = entry.message;
    if (message.role === "user") {
      return { id: entry.id, kind: "user", label: label(redactLocalPaths(visibleWorkspacePrompt(asText(message.content))), "用户消息"), timestamp: timestamp(entry.timestamp) };
    }
    if (message.role === "assistant") {
      return { id: entry.id, kind: "assistant", label: label(visibleAssistantText(message.content), message.errorMessage ? "回复失败" : "助手回复"), timestamp: timestamp(entry.timestamp) };
    }
    if (message.role === "toolResult") {
      return { id: entry.id, kind: "tool", label: `工具：${message.toolName}`, timestamp: timestamp(entry.timestamp) };
    }
    return { id: entry.id, kind: "metadata", label: "会话消息", timestamp: timestamp(entry.timestamp) };
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return { id: entry.id, kind: "summary", label: "已压缩的上下文", timestamp: timestamp(entry.timestamp) };
  }
  if (entry.type === "model_change") {
    return { id: entry.id, kind: "setting", label: `模型：${entry.provider}/${entry.modelId}`, timestamp: timestamp(entry.timestamp) };
  }
  if (entry.type === "thinking_level_change") {
    return { id: entry.id, kind: "setting", label: `思考强度：${entry.thinkingLevel}`, timestamp: timestamp(entry.timestamp) };
  }
  if (entry.type === "session_info") {
    return { id: entry.id, kind: "metadata", label: entry.name ? `会话名称：${label(entry.name, "未命名")}` : "会话名称已清除", timestamp: timestamp(entry.timestamp) };
  }
  if (entry.type === "label") {
    return { id: entry.id, kind: "metadata", label: entry.label ? `标签：${label(entry.label, "")}` : "标签已清除", timestamp: timestamp(entry.timestamp) };
  }
  return { id: entry.id, kind: "metadata", label: "内部会话条目", timestamp: timestamp(entry.timestamp) };
}

function projectNodes(nodes: SessionTreeNode[]): SafeSessionTreeNode[] {
  return nodes.flatMap((node) => {
    const children = projectNodes(node.children);
    if (node.entry.type === "message" && node.entry.message.role === "toolResult") return children;
    return [{ ...projectEntry(node.entry), children }];
  });
}

function flattenNodes(nodes: SessionTreeNode[]): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    result.push(node);
    for (const child of [...node.children].reverse()) pending.push(child);
  }
  return result;
}

export function projectSessionTree(sessionManager: SessionManager, limit = MAX_SESSION_TREE_NODES) {
  const source = sessionManager.getTree();
  const nodes = flattenNodes(source);
  if (nodes.length <= limit) return { tree: projectNodes(source), truncated: false };

  return {
    tree: nodes.slice(-limit)
      .filter((node) => node.entry.type !== "message" || node.entry.message.role !== "toolResult")
      .map((node) => ({ ...projectEntry(node.entry), children: [] })),
    truncated: true,
  };
}
