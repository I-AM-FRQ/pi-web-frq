import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "@/contracts";
import { readChatStreamEvents, reconnectDelayMs } from "./use-chat-stream";

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
