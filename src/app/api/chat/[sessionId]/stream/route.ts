import { NextRequest, NextResponse } from "next/server";
import { hasActiveChatRun, subscribeToActiveChatRun } from "@/server/active-chat-runs";
import { SSE_HEADERS, sseEvent } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!isSessionId(sessionId)) return NextResponse.json({ error: { code: "invalid_session", message: "Session id is invalid." } }, { status: 400 });
  if (!hasActiveChatRun(sessionId)) return NextResponse.json({ error: { code: "run_not_found", message: "No active run exists for this session." } }, { status: 404 });

  let detach: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        detach?.();
        try { controller.close(); } catch { /* reader may already have cancelled */ }
      };
      detach = subscribeToActiveChatRun(sessionId, (event) => {
        if (closed) return;
        try {
          controller.enqueue(sseEvent(event));
          if (event.type === "done" || event.type === "error") close();
        } catch {
          close();
        }
      });
      if (!detach) close();
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      detach?.();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
