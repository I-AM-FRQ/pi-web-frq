import { NextRequest, NextResponse } from "next/server";
import { abortActiveChatRun } from "@/server/active-chat-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const sessionId = typeof body === "object" && body !== null ? (body as { sessionId?: unknown }).sessionId : undefined;
  if (!isSessionId(sessionId)) {
    return NextResponse.json({ error: { code: "invalid_session", message: "Session id is invalid." } }, { status: 400 });
  }
  try {
    const aborted = await abortActiveChatRun(sessionId);
    return NextResponse.json({ aborted }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to stop chat session", error);
    return NextResponse.json({ error: { code: "stop_failed", message: "Unable to stop the running session." } }, { status: 500 });
  }
}
