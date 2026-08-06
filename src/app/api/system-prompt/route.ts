import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/server/projects";
import { getWorkspaceSystemPrompt } from "@/server/pi";
import { workspaceForProjectId } from "@/server/project-workspace";
import { redactLocalPaths } from "@/server/output-sanitization";
import { MAX_CUSTOM_SYSTEM_PROMPT_LENGTH, readGlobalAgentInstructions, readProjectSystemPrompt, writeGlobalAgentInstructions, writeProjectSystemPrompt } from "@/server/system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const PROJECT_ID_PATTERN = /^project-[a-z0-9-]{8,80}$/;

function projectIdFrom(request: NextRequest): string | null {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (projectId !== null && !PROJECT_ID_PATTERN.test(projectId)) throw new Error("invalid_project_request");
  return projectId;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("scope") === "global") {
    try {
      return NextResponse.json({ global: await readGlobalAgentInstructions() }, { headers: NO_STORE });
    } catch (caught) {
      console.error("Unable to read global AGENTS.md", caught);
      return NextResponse.json({ error: { code: "system_prompt_unavailable", message: "无法读取全局 AGENTS.md。" } }, { status: 503, headers: NO_STORE });
    }
  }

  let projectId: string | null;
  try {
    projectId = projectIdFrom(request);
  } catch {
    return NextResponse.json({ error: { code: "invalid_project_request", message: "项目标识无效。" } }, { status: 400, headers: NO_STORE });
  }

  try {
    const [workspacePath, project] = await Promise.all([
      workspaceForProjectId(projectId),
      projectId ? getProject(projectId) : Promise.resolve(null),
    ]);
    const [prompt, projectPrompt] = await Promise.all([
      getWorkspaceSystemPrompt(workspacePath),
      readProjectSystemPrompt(workspacePath),
    ]);
    return NextResponse.json({
      name: project?.name ?? "默认工作区",
      prompt: redactLocalPaths(prompt).replaceAll("<workspace>", workspacePath),
      projectPrompt: redactLocalPaths(projectPrompt),
    }, { headers: NO_STORE });
  } catch (caught) {
    console.error("Unable to build project system prompt", caught);
    return NextResponse.json({ error: { code: "system_prompt_unavailable", message: "无法读取当前项目的系统提示词。" } }, { status: 503, headers: NO_STORE });
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }

  if (request.nextUrl.searchParams.get("scope") === "global") {
    const global = body && typeof body === "object" && "global" in body ? (body as { global: unknown }).global : undefined;
    if (typeof global !== "string" || global.length > MAX_CUSTOM_SYSTEM_PROMPT_LENGTH) {
      return NextResponse.json({ error: { code: "invalid_system_prompt", message: `全局 AGENTS.md 不能超过 ${MAX_CUSTOM_SYSTEM_PROMPT_LENGTH} 字符。` } }, { status: 400, headers: NO_STORE });
    }
    try {
      return NextResponse.json({ global: await writeGlobalAgentInstructions(global) }, { headers: NO_STORE });
    } catch (caught) {
      console.error("Unable to save global AGENTS.md", caught);
      return NextResponse.json({ error: { code: "system_prompt_unavailable", message: "无法保存全局 AGENTS.md。" } }, { status: 503, headers: NO_STORE });
    }
  }

  let projectId: string | null;
  try {
    projectId = projectIdFrom(request);
  } catch {
    return NextResponse.json({ error: { code: "invalid_project_request", message: "项目标识无效。" } }, { status: 400, headers: NO_STORE });
  }
  const projectPrompt = body && typeof body === "object" && "projectPrompt" in body ? (body as { projectPrompt: unknown }).projectPrompt : undefined;
  if (typeof projectPrompt !== "string" || projectPrompt.length > MAX_CUSTOM_SYSTEM_PROMPT_LENGTH) {
    return NextResponse.json({ error: { code: "invalid_system_prompt", message: `项目系统提示词不能超过 ${MAX_CUSTOM_SYSTEM_PROMPT_LENGTH} 字符。` } }, { status: 400, headers: NO_STORE });
  }
  try {
    const workspacePath = await workspaceForProjectId(projectId);
    return NextResponse.json({ projectPrompt: await writeProjectSystemPrompt(projectPrompt, workspacePath) }, { headers: NO_STORE });
  } catch (caught) {
    console.error("Unable to save project system prompt", caught);
    return NextResponse.json({ error: { code: "system_prompt_unavailable", message: "无法保存项目系统提示词。" } }, { status: 503, headers: NO_STORE });
  }
}
