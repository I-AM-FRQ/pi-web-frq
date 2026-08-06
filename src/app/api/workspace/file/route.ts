import { NextRequest, NextResponse } from "next/server";
import { isWorkspaceFileError, previewWorkspaceFile } from "@/server/workspace-files";
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
  const relativePath = request.nextUrl.searchParams.get("path");
  if (relativePath === null) {
    return errorResponse("invalid_workspace_path", "Workspace path is invalid or unavailable.", 400);
  }

  try {
    return NextResponse.json(await previewWorkspaceFile(relativePath, await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isWorkspaceFileError(error)) {
      const status = error.code === "not_found" ? 404 : error.code === "too_large" ? 413 : error.code === "binary" ? 415 : 400;
      const code = error.code === "not_found"
        ? "workspace_file_not_found"
        : error.code === "too_large"
          ? "workspace_file_too_large"
          : error.code === "binary"
            ? "workspace_file_binary"
            : "invalid_workspace_path";
      return errorResponse(code, error.message, status);
    }
    return errorResponse("invalid_workspace_path", "Workspace path is invalid or unavailable.", 400);
  }
}
