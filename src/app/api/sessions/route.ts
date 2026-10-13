import { NextResponse } from "next/server";
import { getSessionProjectIds, listProjects } from "@/server/projects";
import { listAllProjectSessions } from "@/server/session-workspaces";
import { listRoomParticipantSessionIds } from "@/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export async function GET() {
  try {
    const [sessions, projects, sessionProjectIds, roomSessionIds] = await Promise.all([listAllProjectSessions(), listProjects(), getSessionProjectIds(), listRoomParticipantSessionIds()]);
    // 聊天室角色的会话属于房间，不在会话列表中单独展示。
    const visibleSessions = sessions.filter((session) => !roomSessionIds.has(session.id));
    return NextResponse.json({ sessions: visibleSessions, projects, sessionProjectIds }, { headers: NO_STORE });
  } catch (error) {
    console.error("Unable to list Pi sessions", error);
    return errorResponse("sessions_unavailable", "Unable to list sessions.", 503);
  }
}

