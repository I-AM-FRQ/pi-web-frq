import { NextRequest, NextResponse } from "next/server";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { assignSessionToProject } from "@/server/projects";
import { projectIdForSession } from "@/server/session-workspaces";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

function error(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_project_assignment", message } }, { status, headers: NO_STORE });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) return error("Session id is invalid.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("projectId" in body) || ((body as { projectId?: unknown }).projectId !== null && typeof (body as { projectId?: unknown }).projectId !== "string")) {
    return error("projectId must be a string or null.");
  }
  try {
    const projectId = (body as { projectId: string | null }).projectId;
    const currentProjectId = await projectIdForSession(sessionId);
    if (currentProjectId && currentProjectId !== projectId) return error("Sessions cannot move between isolated project workspaces.", 409);
    await assignSessionToProject(sessionId, projectId);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to move session.");
  }
}
