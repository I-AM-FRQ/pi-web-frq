import { NextRequest, NextResponse } from "next/server";
import { appendRoomMessage, getRoom, listRoomMessages, validParticipantId } from "@/server/rooms";
import { startParticipantReply } from "@/server/room-runs";
import { routeRoomMessage, type RoomRouting } from "@/server/room-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * 用户在聊天室发言。
 * - 群聊（不传 targetParticipantId）：消息对全房间公开，并触发所有角色各自响应。
 * - 私聊（传 targetParticipantId）：消息只对该角色可见，只有它响应。
 *
 * 各角色并发启动响应：启动阶段在请求内完成（打开会话、注册运行、发起输出），
 * 模型输出在后台继续并写回房间消息，前端通过流接口观察实时输出。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const room = await getRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: { code: "room_not_found", message: "聊天室不存在。" } }, { status: 404, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { content?: unknown; targetParticipantId?: unknown })
    : {};

  const targetParticipantId = typeof payload.targetParticipantId === "string" ? payload.targetParticipantId : undefined;
  if (targetParticipantId && !validParticipantId(targetParticipantId)) {
    return NextResponse.json({ error: { code: "invalid_target", message: "私聊目标无效。" } }, { status: 400, headers: NO_STORE });
  }
  let routing: RoomRouting | null = null;
  let targets;
  if (targetParticipantId) {
    targets = room.participants.filter((participant) => participant.id === targetParticipantId);
    if (targets.length === 0) {
      return NextResponse.json({ error: { code: "participant_not_found", message: "目标角色不存在。" } }, { status: 404, headers: NO_STORE });
    }
  } else {
    // 群聊：@指定优先，其次群发关键词，否则由决策模型辨认该谁回应（避免所有角色无脑响应）
    routing = await routeRoomMessage({ room, content: typeof payload.content === "string" ? payload.content : "", messages: await listRoomMessages(roomId) });
    targets = room.participants.filter((participant) => routing!.targets.includes(participant.id));
  }
  const visibility = targetParticipantId ? "private" as const : "room" as const;

  let stored;
  try {
    stored = await appendRoomMessage({
      roomId,
      sender: { type: "user" },
      content: payload.content as string,
      visibility,
      ...(targetParticipantId ? { targetParticipantId } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "invalid_message", message: error instanceof Error ? error.message : "消息无效。" } },
      { status: 400, headers: NO_STORE },
    );
  }

  const contextMessages = await listRoomMessages(roomId);
  // 各角色并发启动响应（启动阶段在请求内完成，输出在后台继续并写回房间消息）。
  const results = await Promise.allSettled(targets.map((participant) => startParticipantReply({
    room,
    participant,
    content: stored.content,
    messages: contextMessages,
    visibility,
  })));
  const outcomes = results.map((result, index) => result.status === "rejected"
    ? { role: targets[index].role, participantId: targets[index].id, ok: false, reason: String(result.reason).slice(0, 200) }
    : { role: targets[index].role, participantId: targets[index].id, ...result.value });
  for (const outcome of outcomes) {
    if (!outcome.ok) console.warn("Room participant skipped:", JSON.stringify(outcome));
  }

  return NextResponse.json(
    {
      message: stored,
      triggered: targets.map((participant) => participant.id),
      outcomes,
      // 路由说明：让前端能提示“已点名：X”/“未匹配到角色，可用 @ 指定”
      ...(routing ? { routing: { reason: routing.reason, detail: routing.detail ?? "" } } : {}),
    },
    { status: 202, headers: NO_STORE },
  );
}
