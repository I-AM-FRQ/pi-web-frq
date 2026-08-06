import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceGitStatus, listWorkspaceGitBranches, listWorkspaceGitLog, runWorkspaceGitAction, type WorkspaceGitAction } from "@/server/workspace-git";
import { workspaceForProjectId } from "@/server/project-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function parseGitAction(value: unknown): WorkspaceGitAction {
  if (typeof value !== "object" || value === null) throw new Error("Git action is invalid.");
  const action = (value as { action?: unknown }).action;
  if (action === "stage" || action === "unstage") {
    const paths = (value as { paths?: unknown }).paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 250 || !paths.every((item) => typeof item === "string")) {
      throw new Error("Git paths are invalid.");
    }
    return { action, paths: paths as string[] };
  }
  if (action === "commit") {
    const message = (value as { message?: unknown }).message;
    if (typeof message !== "string" || message.trim().length === 0 || message.length > 2000) {
      throw new Error("Commit message is invalid.");
    }
    return { action, message: message.trim() };
  }
  if (action === "switch") {
    const branch = (value as { branch?: unknown }).branch;
    if (typeof branch !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/\-]*$/.test(branch)) {
      throw new Error("Branch name is invalid.");
    }
    return { action, branch };
  }
  throw new Error("Git action is invalid.");
}

export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view") ?? "status";
  try {
    const root = await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"));
    if (view === "branches") return NextResponse.json(await listWorkspaceGitBranches(root), { headers: { "Cache-Control": "no-store" } });
    if (view === "log") return NextResponse.json(await listWorkspaceGitLog(20, root), { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(await getWorkspaceGitStatus(root), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to read Git state", error);
    return errorResponse("git_unavailable", "Unable to read Git state for this workspace.", 503);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", "Request body must be valid JSON.", 400);
  }

  let action: WorkspaceGitAction;
  try {
    action = parseGitAction(body);
  } catch (error) {
    return errorResponse("invalid_git_action", error instanceof Error ? error.message : "Git action is invalid.", 400);
  }

  try {
    const root = await workspaceForProjectId(request.nextUrl.searchParams.get("projectId"));
    const output = await runWorkspaceGitAction(action, root);
    return NextResponse.json({ ok: true, changed: output.length > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to run Git action", error);
    return errorResponse("git_action_failed", error instanceof Error ? error.message : "The Git action could not be completed.", 400);
  }
}
