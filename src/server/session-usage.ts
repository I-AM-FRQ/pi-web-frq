import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

export type SessionUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  usageRecords: number;
};

type UsageLike = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
  cost?: { total?: unknown };
};

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageFromEntry(entry: SessionEntry): UsageLike | undefined {
  if (entry.type === "compaction" || entry.type === "branch_summary") return entry.usage;
  if (entry.type !== "message") return undefined;
  const message = entry.message;
  return message.role === "assistant" || message.role === "toolResult" ? message.usage : undefined;
}

export function projectSessionUsage(sessionManager: SessionManager, entryId?: string): SessionUsage {
  const totals: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    usageRecords: 0,
  };

  for (const entry of sessionManager.getBranch(entryId)) {
    const usage = usageFromEntry(entry);
    if (!usage) continue;
    const input = finiteNonNegative(usage.input);
    const output = finiteNonNegative(usage.output);
    const cacheRead = finiteNonNegative(usage.cacheRead);
    const cacheWrite = finiteNonNegative(usage.cacheWrite);
    const total = finiteNonNegative(usage.totalTokens) || input + output + cacheRead + cacheWrite;
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cacheRead;
    totals.cacheWriteTokens += cacheWrite;
    totals.totalTokens += total;
    totals.cost += finiteNonNegative(usage.cost?.total);
    totals.usageRecords += 1;
  }

  return totals;
}
