import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: "",
  prompt: vi.fn(async () => {}),
  dispose: vi.fn(),
}));

vi.mock("@/server/pi", () => ({
  getAvailableModels: vi.fn(async () => [{ provider: "test", id: "model" }]),
  createChatSession: vi.fn(async () => ({
    session: {
      sessionId: "chat-run",
      subscribe: vi.fn(() => () => {}),
      prompt: state.prompt,
      dispose: state.dispose,
    },
  })),
}));
vi.mock("@/server/session-workspaces", () => ({
  workspaceForSession: vi.fn(async () => state.workspace),
  openProjectPersistentSession: vi.fn(async () => ({ buildSessionContext: () => ({}) })),
}));
vi.mock("@/server/session-lock", () => ({ tryLockSession: vi.fn(() => ({ release: vi.fn() })) }));
vi.mock("@/server/sessions", () => ({ invalidateSessionIndex: vi.fn() }));
vi.mock("@/server/frq-activity", () => ({ recordFrqSessionActivity: vi.fn(async () => {}) }));
vi.mock("@/server/active-chat-runs", () => ({
  activeChatSession: vi.fn(() => null),
  publishActiveChatRunEvent: vi.fn(),
  registerActiveChatRun: vi.fn(),
  unregisterActiveChatRun: vi.fn(),
}));
vi.mock("@/server/session-projection", () => ({
  sanitizeSubagentDetails: vi.fn(),
  toolResultText: vi.fn(),
  toolStepLabel: vi.fn(),
}));

import { POST } from "./route";

const token = "test-wake-token";

function wakeRequest(taskId = "task-1") {
  return new Request("http://localhost/api/frq/wake", {
    method: "POST",
    headers: { "content-type": "application/json", "x-pi-frq-wake-token": token },
    body: JSON.stringify({ sessionId: "session-a", taskId, summary: "completed" }),
  }) as Parameters<typeof POST>[0];
}

afterEach(async () => {
  delete process.env.PI_FRQ_WAKE_TOKEN;
  state.prompt.mockClear();
  state.dispose.mockClear();
  if (state.workspace) await rm(state.workspace, { recursive: true, force: true });
  state.workspace = "";
});

describe("POST /api/frq/wake", () => {
  it("delivers a taskId only once and replays its persisted terminal result", async () => {
    state.workspace = await mkdtemp(join(tmpdir(), "frq-wake-"));
    process.env.PI_FRQ_WAKE_TOKEN = token;

    const first = await POST(wakeRequest());
    const second = await POST(wakeRequest());

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ accepted: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ accepted: true, delivered: true, replayed: true });
    expect(state.prompt).toHaveBeenCalledTimes(1);
  });
});
