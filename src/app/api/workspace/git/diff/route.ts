import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceGitDiff, parseGitDiffMode } from "@/server/workspace-git";
import { workspaceForProjectId } from "@/server/project-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (path === null) {
    return NextResponse.json(
      { error: { code: "invalid_workspace_path", message: "Workspace path is invalid or unavailable." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const mode = parseGitDiffMode(request.nextUrl.searchParams.get("mode"));
    return NextResponse.json(await getWorkspaceGitDiff(path, mode, await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read Git diff for this workspace.";
    const invalidPath = message === "Workspace path is invalid or unavailable.";
    const invalidMode = message === "Git diff mode is invalid.";
    return NextResponse.json(
      { error: { code: invalidPath ? "invalid_workspace_path" : invalidMode ? "invalid_git_diff_mode" : "git_unavailable", message: invalidPath || invalidMode ? message : "Unable to read Git diff for this workspace." } },
      { status: invalidPath || invalidMode ? 400 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
