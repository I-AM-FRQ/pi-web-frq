import { NextRequest, NextResponse } from "next/server";
import { getFrqBroker, taskBelongsToSession, taskSnapshot, tasksForSession } from "@/server/frq-tasks";
import { SSE_HEADERS, sseEvent } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function encode(event: { type: "snapshot"; tasks: ReturnType<typeof taskSnapshot>[] } | { type: "update"; task: ReturnType<typeof taskSnapshot> } | { type: "heartbeat" }): Uint8Array {
  return sseEvent(event as unknown as Parameters<typeof sseEvent>[0]);
}

export function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  if (!isSessionId(sessionId)) return NextResponse.json({ error: { code: "invalid_session", message: "sessionId is invalid." } }, { status: 400 });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try { controller.close(); } catch { /* client disconnected */ }
      };
      controller.enqueue(encode({ type: "snapshot", tasks: tasksForSession(sessionId).map(taskSnapshot) }));
      const broker = getFrqBroker();
      if (broker) {
        unsubscribe = broker.subscribe(({ task }) => {
          if (!closed && taskBelongsToSession(task, sessionId)) controller.enqueue(encode({ type: "update", task: taskSnapshot(task) }));
        });
      } else {
        heartbeat = setInterval(() => { if (!closed) controller.enqueue(encode({ type: "heartbeat" })); }, 15_000);
      }
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
