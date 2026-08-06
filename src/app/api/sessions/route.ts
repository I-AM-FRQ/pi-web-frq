import { NextResponse } from "next/server";
import { getSessionProjectIds, listProjects } from "@/server/projects";
import { listAllProjectSessions } from "@/server/session-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export async function GET() {
  try {
    const [sessions, projects, sessionProjectIds] = await Promise.all([listAllProjectSessions(), listProjects(), getSessionProjectIds()]);
    return NextResponse.json({ sessions, projects, sessionProjectIds }, { headers: NO_STORE });
  } catch (error) {
    console.error("Unable to list Pi sessions", error);
    return errorResponse("sessions_unavailable", "Unable to list sessions.", 503);
  }
}

