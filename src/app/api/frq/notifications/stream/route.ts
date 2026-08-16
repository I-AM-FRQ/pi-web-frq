import { NextRequest, NextResponse } from "next/server";
import { initialFrqNotificationCursor, readFrqCompletionNotifications, type FrqCompletionNotification } from "@/server/frq-notifications";
import { SSE_HEADERS } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function encode(event: { type: "completion"; notification: FrqCompletionNotification } | { type: "error"; code: string; message: string }): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  if (!isSessionId(sessionId)) return NextResponse.json({ error: { code: "invalid_session", message: "sessionId is invalid." } }, { status: 400 });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cursor = initialFrqNotificationCursor();
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try { controller.close(); } catch { /* client disconnected */ }
      };
      const poll = async () => {
        try {
          const result = await readFrqCompletionNotifications(sessionId, cursor);
          cursor = result.cursor;
          for (const notification of result.notifications) {
            if (!closed) controller.enqueue(encode({ type: "completion", notification }));
          }
          if (!closed) timer = setTimeout(() => { void poll(); }, 1_000);
        } catch (error) {
          console.error("Unable to read FRQ completion notifications", error);
          if (!closed) controller.enqueue(encode({ type: "error", code: "notifications_unavailable", message: "FRQ notification stream could not read its event log." }));
          close();
        }
      };
      void poll();
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() { if (timer) clearTimeout(timer); },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
