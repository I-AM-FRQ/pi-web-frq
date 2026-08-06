import { afterEach, describe, expect, it, vi } from "vitest";
import { abortActiveChatRun, activeChatRunStopRequested, publishActiveChatRunEvent, registerActiveChatRun, subscribeToActiveChatRun, unregisterActiveChatRun } from "./active-chat-runs";

const sessionId = "test-active-chat-run";

describe("active chat runs", () => {
  afterEach(() => {
    unregisterActiveChatRun(sessionId, { abort: () => undefined });
  });

  it("marks a run as stopped and waits for its cleanup", async () => {
    const abort = vi.fn();
    const session = { abort };
    registerActiveChatRun(sessionId, session);

    const stopping = abortActiveChatRun(sessionId);
    await Promise.resolve();
    expect(abort).toHaveBeenCalledOnce();
    expect(activeChatRunStopRequested(sessionId)).toBe(true);

    unregisterActiveChatRun(sessionId, session);
    await expect(stopping).resolves.toBe(true);
    await expect(abortActiveChatRun(sessionId)).resolves.toBe(false);
  });

  it("replays buffered events and continues delivering later events", () => {
    const session = { abort: () => undefined };
    registerActiveChatRun(sessionId, session);
    publishActiveChatRunEvent(sessionId, { type: "start", runId: "run-1", sessionId, prompt: "continue" });
    publishActiveChatRunEvent(sessionId, { type: "thinking_delta", delta: "first" });

    const events: string[] = [];
    const unsubscribe = subscribeToActiveChatRun(sessionId, (event) => {
      if (event.type === "start") events.push(`start:${event.prompt}`);
      if (event.type === "thinking_delta") events.push(`thinking:${event.delta}`);
      if (event.type === "text_delta") events.push(`text:${event.delta}`);
    });
    publishActiveChatRunEvent(sessionId, { type: "text_delta", delta: "later" });
    unsubscribe?.();
    publishActiveChatRunEvent(sessionId, { type: "text_delta", delta: "ignored" });

    expect(events).toEqual(["start:continue", "thinking:first", "text:later"]);
  });
});
