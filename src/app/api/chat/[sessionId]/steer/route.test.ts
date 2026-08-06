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
  it("queues a steer message on the running session", async () => {
    const steer = vi.fn().mockResolvedValue(undefined);
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ steer, followUp: vi.fn() });
    const response = await POST(makeRequest({ text: "继续", behavior: "steer" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(200);
    expect(steer).toHaveBeenCalledWith("继续", undefined);
    expect(await response.json()).toEqual({ ok: true, behavior: "steer" });
  });

  it("queues a follow-up message when requested", async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    (activeChatSession as ReturnType<typeof vi.fn>).mockReturnValue({ steer: vi.fn(), followUp });
    const response = await POST(makeRequest({ text: "之后再说", behavior: "followUp" }), { params: Promise.resolve({ sessionId: "session_42-abc" }) });
    expect(response.status).toBe(200);
    expect(followUp).toHaveBeenCalledWith("之后再说", undefined);
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
