import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

function error(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_project_request", message } }, { status, headers: NO_STORE });
}

export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() }, { headers: NO_STORE });
  } catch (caught) {
    console.error("Unable to list projects", caught);
    return error("Unable to load projects.", 503);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof (body as { name?: unknown }).name !== "string" || ((body as { workspacePath?: unknown }).workspacePath !== undefined && typeof (body as { workspacePath?: unknown }).workspacePath !== "string")) return error("name and workspacePath are invalid.");
  try {
    const data = body as { name: string; workspacePath?: string };
    return NextResponse.json({ project: await createProject(data.name, data.workspacePath) }, { status: 201, headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to create project.");
  }
}
