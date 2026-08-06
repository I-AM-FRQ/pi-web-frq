import { NextRequest, NextResponse } from "next/server";
import { deleteProject, renameProject } from "@/server/projects";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

function error(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_project_request", message } }, { status, headers: NO_STORE });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof (body as { name?: unknown }).name !== "string") return error("name must be text.");
  try {
    return NextResponse.json({ project: await renameProject(projectId, (body as { name: string }).name) }, { headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to rename project.");
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  try {
    await deleteProject(projectId);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to delete project.");
  }
}
