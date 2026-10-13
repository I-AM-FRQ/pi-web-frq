import { NextRequest, NextResponse } from "next/server";
import { createRoom, listRooms } from "@/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const projectIdParam = request.nextUrl.searchParams.get("projectId");
  try {
    // projectId= 空串表示“无项目”（null），null（未传参）表示不过滤
    const rooms = await listRooms(projectIdParam === null ? undefined : projectIdParam === "" ? null : projectIdParam);
    return NextResponse.json({ rooms }, { headers: NO_STORE });
  } catch (error) {
    console.error("Unable to list rooms", error);
    return NextResponse.json({ error: { code: "rooms_unavailable", message: "无法读取聊天室列表。" } }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体格式不正确。" } }, { status: 400, headers: NO_STORE });
  }
  const payload = body as { projectId?: unknown; name?: unknown; roles?: unknown };
  const projectId = payload.projectId === null || payload.projectId === undefined
    ? null
    : typeof payload.projectId === "string" ? payload.projectId : undefined;
  if (projectId === undefined) {
    return NextResponse.json({ error: { code: "invalid_project", message: "项目标识无效。" } }, { status: 400, headers: NO_STORE });
  }
  const roles = Array.isArray(payload.roles)
    ? payload.roles.map((item) => (item && typeof item === "object" ? { role: (item as { role?: unknown }).role, modelKey: (item as { modelKey?: unknown }).modelKey } : {}))
    : undefined;
  if (!roles) {
    return NextResponse.json({ error: { code: "invalid_roles", message: "需要提供角色列表。" } }, { status: 400, headers: NO_STORE });
  }
  try {
    const room = await createRoom({
      projectId,
      name: payload.name as string,
      roles: roles as Array<{ role: string; modelKey: string }>,
    });
    return NextResponse.json({ room }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "room_create_failed", message: error instanceof Error ? error.message : "创建聊天室失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}
