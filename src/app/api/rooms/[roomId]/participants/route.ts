import { NextRequest, NextResponse } from "next/server";
import { addParticipant } from "@/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** 新增角色：为该角色新建一个独立持久会话，并指定初始模型。 */
export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { role?: unknown; modelKey?: unknown })
    : {};
  try {
    const room = await addParticipant(roomId, { role: payload.role as string, modelKey: payload.modelKey as string });
    return NextResponse.json({ room }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "participant_add_failed", message: error instanceof Error ? error.message : "添加角色失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}
