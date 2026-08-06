import { NextResponse } from "next/server";
import type { SessionContextSummary } from "@/contracts";
import { activeChatSession } from "@/server/active-chat-runs";
import { projectSessionContext } from "@/server/session-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!isSessionId(sessionId)) {
    return NextResponse.json({ error: { code: "invalid_session", message: "Session id is invalid." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const session = activeChatSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: { code: "run_not_found", message: "No active run exists for this session." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  if (!session.sessionManager || !session.getContextUsage) {
    return NextResponse.json({ error: { code: "context_unavailable", message: "Live context is unavailable for this run." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const usage = session.getContextUsage();
  const estimated = projectSessionContext(session.sessionManager, session.model?.contextWindow ?? null);
  const liveContext: SessionContextSummary = usage ? {
    ...estimated,
    tokens: usage.tokens ?? estimated.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    model: session.model ? { provider: session.model.provider, id: session.model.id } : estimated.model,
  } : estimated;

  return NextResponse.json({ context: liveContext }, { headers: { "Cache-Control": "no-store" } });
}
