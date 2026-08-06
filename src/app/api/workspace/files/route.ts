import { NextRequest, NextResponse } from "next/server";
import { isWorkspaceFileError, searchWorkspaceFiles } from "@/server/workspace-files";
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
  const query = request.nextUrl.searchParams.get("query");
  if (query === null) {
    return errorResponse("invalid_workspace_query", "Workspace search query is invalid.", 400);
  }

  try {
    return NextResponse.json(await searchWorkspaceFiles(query, await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isWorkspaceFileError(error)) {
      return errorResponse("invalid_workspace_query", "Workspace search query is invalid.", 400);
    }
    return errorResponse("invalid_workspace_query", "Workspace search query is invalid.", 400);
  }
}
