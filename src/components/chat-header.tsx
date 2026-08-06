"use client";

import { SessionTitle } from "@/components/session-title";
import { SessionUsage } from "@/components/session-usage";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionContextSummary, SessionUsage as SessionUsageData } from "@/contracts";

type ChatHeaderProps = {
  title: string;
  usage: SessionUsageData | undefined;
  context: SessionContextSummary | null | undefined;
  tokenSpeed: number;
  isStreaming: boolean;
  onOpenSessions: () => void;
  onOpenWorkspace: () => void;
};

export function ChatHeader({ title, usage, context, tokenSpeed, isStreaming, onOpenSessions, onOpenWorkspace }: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="mobile-chat-nav"><button type="button" onClick={onOpenSessions} aria-label="打开会话侧栏">会话</button></div>
      <SessionTitle title={title} />
      <div className="chat-header-status">
        <SessionUsage usage={usage} context={context} />
        {isStreaming && tokenSpeed > 0 ? <span className="token-speed">{tokenSpeed.toLocaleString()} t/s</span> : null}
        <span className={`run-badge ${isStreaming ? "active" : ""}`}><i aria-hidden="true" />{isStreaming ? "运行中" : "就绪"}</span>
        <ThemeToggle />
        <button type="button" className="mobile-workspace-button" onClick={onOpenWorkspace} aria-label="打开工作区">工作区</button>
      </div>
    </header>
  );
}
