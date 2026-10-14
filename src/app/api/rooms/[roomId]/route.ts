import { NextRequest, NextResponse } from "next/server";
import { deleteRoom, getRoom, listRoomMessages, renameRoom, setParticipantSession } from "@/server/rooms";
import { hasActiveChatRun } from "@/server/active-chat-runs";
import { findSessionAcrossWorkspaces } from "@/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const room = await getRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: { code: "room_not_found", message: "聊天室不存在。" } }, { status: 404, headers: NO_STORE });
  }
  // 自动修正失效的会话引用：会话文件可能因清理/切换工作区而不在当前目录，
  // 先跨 workspace 找回；确实不存在则清空引用（前端显示“尚未开始”，发送消息会自动重建）。
  const repaired = await Promise.all(room.participants.map(async (participant) => {
    if (!participant.sessionId) return participant;
    const found = await findSessionAcrossWorkspaces(participant.sessionId);
    if (found) return participant;
    await setParticipantSession(roomId, participant.id, "").catch((error) => {
      console.error("Unable to clear stale participant session", error);
    });
    return { ...participant, sessionId: "" };
  }));
  const currentRoom = { ...room, participants: repaired };

  const messages = await listRoomMessages(roomId);
  // 正在运行的角色：前端据此显示“正在输入…”气泡
  const runningParticipantIds = currentRoom.participants
    .filter((participant) => participant.sessionId && hasActiveChatRun(participant.sessionId))
    .map((participant) => participant.id);
  return NextResponse.json({ room: currentRoom, messages, runningParticipantIds }, { headers: NO_STORE });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  const name = body && typeof body === "object" && !Array.isArray(body) ? (body as { name?: unknown }).name : undefined;
  if (typeof name !== "string") {
    return NextResponse.json({ error: { code: "invalid_name", message: "需要提供新的房间名称。" } }, { status: 400, headers: NO_STORE });
  }
  try {
    const room = await renameRoom(roomId, name);
    return NextResponse.json({ room }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "room_update_failed", message: error instanceof Error ? error.message : "更新聊天室失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  try {
    await deleteRoom(roomId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "room_delete_failed", message: error instanceof Error ? error.message : "删除聊天室失败。" } },
      { status: 404, headers: NO_STORE },
    );
  }
}
