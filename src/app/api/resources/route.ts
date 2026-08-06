import { NextRequest, NextResponse } from "next/server";
import { createAgentResource, listAgentResources, setAgentResourceConfiguration, type AgentResourceKind } from "@/server/agent-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function error(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_resource_request", message } }, { status, headers: NO_STORE });
}

function isKind(value: unknown): value is AgentResourceKind {
  return value === "skills" || value === "plugins";
}

export async function GET() {
  try {
    return NextResponse.json(await listAgentResources(), { headers: NO_STORE });
  } catch (caught) {
    console.error("Unable to list agent resources", caught);
    return error("Unable to load skills and plugins.", 503);
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return error("Request body is invalid.");
  const data = body as Record<string, unknown>;
  const directories = data.directories;
  if (!Array.isArray(data.skills) || !Array.isArray(data.plugins) || data.skills.some((item) => typeof item !== "string") || data.plugins.some((item) => typeof item !== "string")
    || (directories !== undefined && (typeof directories !== "object" || directories === null || Array.isArray(directories)
      || !Array.isArray((directories as { skills?: unknown }).skills) || !Array.isArray((directories as { plugins?: unknown }).plugins)
      || (directories as { skills: unknown[] }).skills.some((item) => typeof item !== "string") || (directories as { plugins: unknown[] }).plugins.some((item) => typeof item !== "string")))) {
    return error("skills, plugins, and directories must be string arrays.");
  }
  try {
    return NextResponse.json(await setAgentResourceConfiguration({
      skills: data.skills,
      plugins: data.plugins,
      directories: directories as { skills: string[]; plugins: string[] } | undefined,
    }), { headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to update resource settings.");
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return error("Request body is invalid.");
  const data = body as Record<string, unknown>;
  if (!isKind(data.kind) || typeof data.name !== "string" || (data.content !== undefined && typeof data.content !== "string")) {
    return error("kind, name, and content are invalid.");
  }
  try {
    return NextResponse.json(await createAgentResource(data.kind, data.name, data.content), { status: 201, headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to create resource.");
  }
}
