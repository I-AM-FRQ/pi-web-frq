import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceResponse } from "@/workspace-contracts";
import { workspaceCapabilities, listWorkspaceDirectory } from "@/server/workspace-tools";
import { assertSafeWorkspaceRelativePath } from "@/server/workspace";
import { workspaceForProjectId } from "@/server/project-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path") ?? ".";
  try {
    if (relativePath !== ".") assertSafeWorkspaceRelativePath(relativePath);
    const root = await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"));
    const response: WorkspaceResponse = {
      path: relativePath === "." ? "." : relativePath.replace(/\\/g, "/"),
      entries: await listWorkspaceDirectory(relativePath, root),
      capabilities: workspaceCapabilities,
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse("invalid_workspace_path", "Workspace path is invalid or unavailable.", 400);
  }
}
