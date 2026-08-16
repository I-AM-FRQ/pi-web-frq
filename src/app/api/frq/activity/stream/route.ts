import { NextRequest, NextResponse } from "next/server";
import { readFrqSessionActivities, type FrqSessionActivity } from "@/server/frq-activity";
import { SSE_HEADERS, sseEvent } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function encode(activity: FrqSessionActivity): Uint8Array {
  return sseEvent({ type: "activity", activity } as unknown as Parameters<typeof sseEvent>[0]);
}

function errorEvent(): Uint8Array {
  return sseEvent({ type: "error", code: "activity_unavailable", message: "FRQ activity stream could not read its event log." } as unknown as Parameters<typeof sseEvent>[0]);
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  if (!isSessionId(sessionId)) return NextResponse.json({ error: { code: "invalid_session", message: "sessionId is invalid." } }, { status: 400 });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cursor = { offset: 0, trailing: "" };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try { controller.close(); } catch { /* client disconnected */ }
      };
      const poll = async () => {
        try {
          const result = await readFrqSessionActivities(sessionId, cursor);
          cursor = result.cursor;
          for (const activity of result.activities) if (!closed) controller.enqueue(encode(activity));
          if (!closed) timer = setTimeout(() => { void poll(); }, 1_000);
        } catch (error) {
          console.error("Unable to read FRQ session activity", error);
          if (!closed) controller.enqueue(errorEvent());
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
