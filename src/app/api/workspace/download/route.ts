import { readFile, stat } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { resolveExistingWorkspacePath } from "@/server/workspace";
import { workspaceForProjectId } from "@/server/project-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;

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
    const root = await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"));
    const absolutePath = resolveExistingWorkspacePath(relativePath, root);
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) {
      return errorResponse("invalid_workspace_path", "Workspace path is invalid or unavailable.", 400);
    }
    if (metadata.size > MAX_DOWNLOAD_BYTES) {
      return errorResponse("workspace_file_too_large", "The requested file exceeds the download size limit.", 413);
    }
    const buffer = await readFile(absolutePath);
    const fileName = relativePath.split("/").pop() ?? "workspace-file";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return errorResponse("invalid_workspace_path", "Workspace path is invalid or unavailable.", 400);
  }
}
