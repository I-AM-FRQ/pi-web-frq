import { NextRequest, NextResponse } from "next/server";
import { isWorkspaceFileError, searchWorkspaceContent } from "@/server/workspace-files";
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
    return errorResponse("invalid_workspace_query", "Workspace content search query is invalid.", 400);
  }
  const caseSensitive = request.nextUrl.searchParams.get("caseSensitive") === "true";
  const regex = request.nextUrl.searchParams.get("regex") === "true";

  try {
    const result = await searchWorkspaceContent(query, { caseSensitive, regex }, await workspaceForProjectId(request.nextUrl.searchParams.get("projectId")));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isWorkspaceFileError(error)) {
      return errorResponse("invalid_workspace_query", "Workspace content search query is invalid.", 400);
    }
    return errorResponse("invalid_workspace_query", "Workspace content search query is invalid.", 400);
  }
}
