import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "@/contracts";
import { appendLiveUserMessage, appendPendingQueueItem, applyFollowUpQueueSnapshot, readChatStreamEvents, reconnectDelayMs, type ChatRun } from "./use-chat-stream";

function run(id: string, sessionId: string): ChatRun {
  return {
    id,
    sessionId,
    pendingPrompt: "",
    tools: [],
    timeline: [],
    text: "",
    thinking: "",
    retry: null,
    runId: "",
    error: "",
    queued: [],
    queueVersion: 0,
    stopping: false,
    tokenSpeed: 0,
    isStreaming: true,
    startedAt: 0,
    finishedAt: null,
  };
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe("readChatStreamEvents", () => {
  it("parses JSON events split at arbitrary byte boundaries", async () => {
    const events: ChatStreamEvent[] = [];
    await readChatStreamEvents(streamFromChunks([
      "data: {\"type\":\"start\",\"run",
      "Id\":\"run-1\",\"sessionId\":\"session-1\"}\n\n",
      "data: {\"type\":\"text_delta\",\"delta\":\"你好\"}\n\n",
      "data: {\"type\":\"done\",\"sessionId\":\"session-1\"}\n\n",
    ]), (event) => events.push(event));

    expect(events).toEqual([
      { type: "start", runId: "run-1", sessionId: "session-1" },
      { type: "text_delta", delta: "你好" },
      { type: "done", sessionId: "session-1" },
    ]);
  });

  it("accepts CRLF, comments, and data split across multiple lines", async () => {
    const events: ChatStreamEvent[] = [];
    await readChatStreamEvents(streamFromChunks([
      ": heartbeat\r\n",
      "data: {\"type\":\"text_delta\",\r\ndata: \"delta\":\"two lines\"}\r\n\r\n",
    ]), (event) => events.push(event));

    expect(events).toEqual([{ type: "text_delta", delta: "two lines" }]);
  });

  it("dispatches an unterminated final event when the stream closes", async () => {
    const events: ChatStreamEvent[] = [];
    await readChatStreamEvents(streamFromChunks([
      "data: {\"type\":\"error\",\"code\":\"chat_failed\",\"message\":\"failed\"}",
    ]), (event) => events.push(event));

    expect(events).toEqual([{ type: "error", code: "chat_failed", message: "failed" }]);
  });

  it("parses retry status events", async () => {
    const events: ChatStreamEvent[] = [];
    await readChatStreamEvents(streamFromChunks([
      "data: {\"type\":\"retry_scheduled\",\"attempt\":1,\"maxAttempts\":3,\"delayMs\":2000,\"message\":\"503 busy\"}\n\n",
      "data: {\"type\":\"retry_finished\",\"success\":true,\"attempt\":1}\n\n",
    ]), (event) => events.push(event));

    expect(events).toEqual([
      { type: "retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 2000, message: "503 busy" },
      { type: "retry_finished", success: true, attempt: 1 },
    ]);
  });

  it("rejects malformed event JSON", async () => {
    await expect(readChatStreamEvents(streamFromChunks(["data: not-json\n\n"]), () => undefined)).rejects.toThrow(
      "服务返回了无法解析的流事件。",
    );
  });
});

describe("reconnectDelayMs", () => {
  it("退避增长且 16s 封顶", () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(1)).toBe(2_000);
    expect(reconnectDelayMs(2)).toBe(4_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(4)).toBe(16_000);
    expect(reconnectDelayMs(9)).toBe(16_000);
  });
});

describe("FIFO pending queue", () => {
  it("adds user_message to the live timeline and clears the pending prompt", () => {
    const result = appendLiveUserMessage([run("run-a", "session-a")], "run-a", {
      type: "user_message", content: "开始任务", timestamp: "2026-01-01T00:00:00.000Z", source: "user",
    });

    expect(result[0].pendingPrompt).toBe("");
    expect(result[0].timeline).toEqual([{ kind: "user", content: "开始任务", timestamp: "2026-01-01T00:00:00.000Z", source: "user" }]);
  });

  it("keeps duplicate queue text as distinct FIFO entries and isolates runs", () => {
    const initial = [run("run-a", "session-a"), run("run-b", "session-b")];
    const withLocal = appendPendingQueueItem(initial, "run-a", { id: "local-1", content: "继续", optimistic: true }, 0);
    const withSnapshot = applyFollowUpQueueSnapshot(withLocal, "run-a", ["继续", "继续"]);

    expect(withSnapshot[0].queued.map((item) => item.content)).toEqual(["继续", "继续"]);
    expect(withSnapshot[0].queued.map((item) => item.id)).toEqual(["local-1", expect.any(String)]);
    expect(withSnapshot[1].queued).toEqual([]);
  });

  it("does not append a local transition item after a newer authoritative snapshot", () => {
    const snapshotted = applyFollowUpQueueSnapshot([run("run-a", "session-a")], "run-a", ["服务端消息"]);
    const result = appendPendingQueueItem(snapshotted, "run-a", { id: "late", content: "本地消息", optimistic: true }, 0);

    expect(result[0].queued.map((item) => item.content)).toEqual(["服务端消息"]);
  });
});
