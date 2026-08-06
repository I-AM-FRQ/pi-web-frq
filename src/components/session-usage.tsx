import type { SessionContextSummary, SessionUsage as SessionUsageData } from "@/contracts";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatCost(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

function contextLevel(context: SessionContextSummary | undefined) {
  if (context?.percent === null || context?.percent === undefined) return "";
  if (context.percent >= 85) return "critical";
  if (context.percent >= 70) return "warning";
  return "";
}

export function SessionUsage({ usage, context }: { usage: SessionUsageData | undefined; context?: SessionContextSummary | null }) {
  const showContext = context !== null && context !== undefined;
  const hasContextWindow = context?.contextWindow !== null && context?.contextWindow !== undefined && context.percent !== null && context.percent !== undefined;
  if ((!usage || usage.usageRecords === 0) && !showContext) return null;

  return (
    <section className="session-usage" aria-label="会话状态与用量">
      {showContext ? <span className={`context-usage tooltip-trigger ${contextLevel(context)}`} data-tooltip={hasContextWindow ? `当前上下文 ${formatNumber(context.tokens)} / ${formatNumber(context.contextWindow!)} Token` : `当前上下文已用 ${formatNumber(context.tokens)} Token；模型上下文窗口暂不可用`}>{hasContextWindow ? `${context.percent!.toFixed(0)}% / ${formatCompact(context.contextWindow!)}` : `已用 ${formatCompact(context.tokens)}`}</span> : null}
      {usage && usage.usageRecords > 0 ? <>
        <span className="tooltip-trigger" data-tooltip={`输入 ${formatNumber(usage.inputTokens)} · 输出 ${formatNumber(usage.outputTokens)} · 缓存读取 ${formatNumber(usage.cacheReadTokens)} · 缓存写入 ${formatNumber(usage.cacheWriteTokens)}`}>{formatNumber(usage.totalTokens)} TOKENS</span>
        <span className="tooltip-trigger" data-tooltip={`${usage.usageRecords} 条计费记录`}>{formatCost(usage.cost)}</span>
      </> : null}
    </section>
  );
}
