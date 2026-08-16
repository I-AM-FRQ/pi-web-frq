import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function makeRequest(body: unknown, sessionId = "session_42-abc") {
  return {
    params: Promise.resolve({ sessionId }),
    json: () => Promise.resolve(body),
  } as never;
}

vi.mock("@/server/active-chat-runs", () => ({
  activeChatSession: vi.fn(),
}));

import { activeChatSession } from "@/server/active-chat-runs";

describe("POST /api/chat/[sessionId]/steer", () => {
  it("steers running-session input when steer behavior is requested and available", async () => {
    const steer = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ steer, followUp });
    const response = await POST(makeRequest({ text: "继续", behavior: "steer" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(200);
    expect(steer).toHaveBeenCalledWith("继续", undefined);
    expect(followUp).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ accepted: true, queued: false, behavior: "steer" });
  });

  it("falls back to FIFO follow-up when steer is unavailable", async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ followUp });
    const response = await POST(makeRequest({ text: "继续", behavior: "steer" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(200);
    expect(followUp).toHaveBeenCalledWith("继续", undefined);
    expect(await response.json()).toEqual({ accepted: true, queued: true, behavior: "followUp" });
  });

  it("uses FIFO follow-up by default", async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ steer: vi.fn(), followUp });
    const response = await POST(makeRequest({ text: "之后再说" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(200);
    expect(followUp).toHaveBeenCalledWith("之后再说", undefined);
    expect(await response.json()).toEqual({ accepted: true, queued: true, behavior: "followUp" });
  });

  it("rejects empty or oversized messages", async () => {
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ steer: vi.fn() });
    expect((await POST(makeRequest({ text: "   " }), { params: Promise.resolve({ sessionId: "session_42-abc" }) })).status).toBe(400);
    expect((await POST(makeRequest({ text: "x".repeat(12_001) }), { params: Promise.resolve({ sessionId: "session_42-abc" }) })).status).toBe(400);
    expect((await POST(makeRequest({}), { params: Promise.resolve({ sessionId: "session_42-abc" }) })).status).toBe(400);
  });

  it("returns 404 when the session has no active run", async () => {
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const response = await POST(makeRequest({ text: "继续" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(404);
  });
});
