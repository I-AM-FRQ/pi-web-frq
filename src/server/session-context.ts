import { buildSessionContext, estimateTokens, type SessionManager } from "@earendil-works/pi-coding-agent";

export type SessionContextSummary = {
  scope: "active" | "preview";
  entryCount: number;
  messageCount: { user: number; assistant: number; tool: number; other: number };
  tokens: number;
  contextWindow: number | null;
  percent: number | null;
  model: { provider: string; id: string } | null;
  thinkingLevel: string;
  compacted: boolean;
};

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function projectSessionContext(sessionManager: SessionManager, contextWindow: number | null, entryId?: string): SessionContextSummary {
  const branch = sessionManager.getBranch(entryId);
  const context = entryId
    ? buildSessionContext(sessionManager.getEntries(), entryId)
    : sessionManager.buildSessionContext();
  const messageCount = { user: 0, assistant: 0, tool: 0, other: 0 };
  let compacted = false;

  for (const entry of branch) {
    if (entry.type === "compaction") compacted = true;
    if (entry.type !== "message") {
      messageCount.other += 1;
      continue;
    }
    if (entry.message.role === "user") messageCount.user += 1;
    else if (entry.message.role === "assistant") messageCount.assistant += 1;
    else if (entry.message.role === "toolResult") messageCount.tool += 1;
    else messageCount.other += 1;
  }

  const tokens = context.messages.reduce((total, message) => {
    try {
      return total + safeNumber(estimateTokens(message));
    } catch {
      return total;
    }
  }, 0);
  const window = safeNumber(contextWindow) || null;
  return {
    scope: entryId ? "preview" : "active",
    entryCount: branch.length,
    messageCount,
    tokens,
    contextWindow: window,
    percent: window ? Math.min(100, (tokens / window) * 100) : null,
    model: context.model ? { provider: context.model.provider, id: context.model.modelId } : null,
    thinkingLevel: context.thinkingLevel,
    compacted,
  };
}
