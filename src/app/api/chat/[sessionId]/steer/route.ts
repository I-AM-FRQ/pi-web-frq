import { NextRequest, NextResponse } from "next/server";
import type { ChatImage } from "@/contracts";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { activeChatSession } from "@/server/active-chat-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const MAX_STEER_BYTES = 12_000;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseImages(value: unknown): ChatImage[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 4 || value.some((image) => !isPlainObject(image)
    || image.type !== "image"
    || typeof image.data !== "string"
    || image.data.length === 0
    || image.data.length > 7_000_000
    || typeof image.mimeType !== "string"
    || !IMAGE_MIME_TYPES.has(image.mimeType))) {
    throw new Error("引导消息最多携带 4 张 PNG/JPEG/WebP 图片。");
  }
  return value as ChatImage[];
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json({ error: { code: "invalid_session_id", message: "The session id is invalid." } }, { status: 400, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  if (!isPlainObject(body) || typeof body.text !== "string" || body.text.trim().length === 0 || Buffer.byteLength(body.text, "utf8") > MAX_STEER_BYTES) {
    return NextResponse.json({ error: { code: "invalid_steer", message: "引导消息必须是非空文本且不超过 12000 字节。" } }, { status: 400, headers: NO_STORE });
  }
  let images: ChatImage[] | undefined;
  try {
    images = parseImages(body.images);
  } catch (error) {
    return NextResponse.json({ error: { code: "invalid_steer", message: error instanceof Error ? error.message : "图片参数无效。" } }, { status: 400, headers: NO_STORE });
  }
  const behavior = body.behavior === "followUp" ? "followUp" : "steer";

  const session = activeChatSession(sessionId);
  if (!session || typeof session[behavior] !== "function") {
    return NextResponse.json({ error: { code: "run_not_found", message: "该会话当前没有正在执行的任务。" } }, { status: 404, headers: NO_STORE });
  }

  try {
    await session[behavior](body.text, images);
    return NextResponse.json({ ok: true, behavior }, { headers: NO_STORE });
  } catch (error) {
    console.error("Unable to queue steer message", error);
    return NextResponse.json({ error: { code: "steer_failed", message: "无法插入引导消息。" } }, { status: 503, headers: NO_STORE });
  }
}
