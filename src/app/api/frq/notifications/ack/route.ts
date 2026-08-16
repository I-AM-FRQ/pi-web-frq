import { NextRequest, NextResponse } from "next/server";
import { acknowledgeFrqCompletionNotifications } from "@/server/frq-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ACK_IDS = 200;

async function parseLimitedJson(request: NextRequest): Promise<{ body?: unknown; error?: NextResponse }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return { error: NextResponse.json({ error: { code: "payload_too_large", message: "Request body exceeds 256 KiB." } }, { status: 413 }) };
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) return { error: NextResponse.json({ error: { code: "payload_too_large", message: "Request body exceeds 256 KiB." } }, { status: 413 }) };
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { error: NextResponse.json({ error: { code: "invalid_request", message: "Request body must be UTF-8 JSON." } }, { status: 400 }) };
  }
}

export async function POST(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) return NextResponse.json({ error: { code: "invalid_session", message: "sessionId is invalid." } }, { status: 400 });
  const parsed = await parseLimitedJson(request);
  if (parsed.error) return parsed.error;
  const rawIds = parsed.body && typeof parsed.body === "object" && Array.isArray((parsed.body as { ids?: unknown }).ids)
    ? (parsed.body as { ids: unknown[] }).ids
    : [];
  if (rawIds.length === 0 || rawIds.length > MAX_ACK_IDS) return NextResponse.json({ error: { code: "invalid_request", message: "ids must contain 1 to 200 notification ids." } }, { status: 400 });
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))];
  if (ids.length === 0) return NextResponse.json({ error: { code: "invalid_request", message: "ids must contain valid notification ids." } }, { status: 400 });
  await acknowledgeFrqCompletionNotifications(sessionId, ids);
  return NextResponse.json({ acknowledged: ids.length }, { headers: { "Cache-Control": "no-store" } });
}
