import { NextRequest, NextResponse } from "next/server";
import { removeParticipant, updateParticipant } from "@/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * 更新角色：改角色名或更换模型。
 * 更换模型只改变后续请求使用的 provider:model，会话上下文（历史）保持不变。
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ roomId: string; participantId: string }> }) {
  const { roomId, participantId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { role?: unknown; modelKey?: unknown; roleCard?: unknown; rolePrompt?: unknown })
    : {};
  try {
    const room = await updateParticipant(roomId, participantId, {
      ...(typeof payload.role === "string" ? { role: payload.role } : {}),
      ...(typeof payload.modelKey === "string" ? { modelKey: payload.modelKey } : {}),
      ...(payload.roleCard === null ? { roleCard: null } : typeof payload.roleCard === "string" ? { roleCard: payload.roleCard } : {}),
      // null 表示清除角色卡；字符串表示更新
      ...(payload.rolePrompt === null ? { rolePrompt: null } : typeof payload.rolePrompt === "string" ? { rolePrompt: payload.rolePrompt } : {}),
    });
    return NextResponse.json({ room }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "participant_update_failed", message: error instanceof Error ? error.message : "更新角色失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ roomId: string; participantId: string }> }) {
  const { roomId, participantId } = await context.params;
  try {
    const room = await removeParticipant(roomId, participantId);
    return NextResponse.json({ room }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "participant_remove_failed", message: error instanceof Error ? error.message : "移除角色失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}
