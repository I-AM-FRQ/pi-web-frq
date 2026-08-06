import { NextRequest, NextResponse } from "next/server";
import { deleteAgentResource, updateAgentResource, type AgentResourceKind } from "@/server/agent-resources";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

function error(message: string, status = 400) {
  return NextResponse.json({ error: { code: "invalid_resource_request", message } }, { status, headers: NO_STORE });
}

function kind(value: string): AgentResourceKind | null {
  return value === "skills" || value === "plugins" ? value : null;
}

export async function PUT(request: NextRequest, context: { params: Promise<{ kind: string; name: string }> }) {
  const params = await context.params;
  const resourceKind = kind(params.kind);
  if (!resourceKind) return error("Resource kind is invalid.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof (body as { content?: unknown }).content !== "string") {
    return error("content must be a string.");
  }
  try {
    return NextResponse.json(await updateAgentResource(resourceKind, params.name, (body as { content: string }).content), { headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to update resource.");
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ kind: string; name: string }> }) {
  const params = await context.params;
  const resourceKind = kind(params.kind);
  if (!resourceKind) return error("Resource kind is invalid.");
  try {
    return NextResponse.json(await deleteAgentResource(resourceKind, params.name), { headers: NO_STORE });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "Unable to delete resource.");
  }
}
