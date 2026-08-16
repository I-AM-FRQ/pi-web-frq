import { NextRequest, NextResponse } from "next/server";
import { taskSnapshot, tasksForSession } from "@/server/frq-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  if (!isSessionId(sessionId)) {
    return NextResponse.json({ error: { code: "invalid_session", message: "sessionId is invalid." } }, { status: 400 });
  }

  return NextResponse.json(
    { tasks: tasksForSession(sessionId).map(taskSnapshot) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
