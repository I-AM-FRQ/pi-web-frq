import { describe, expect, it } from "vitest";
import type { ChatRun } from "@/client/use-chat-stream";
import { planCompletionNotices } from "./use-completion-notifier";

function finishedRun(overrides: Partial<ChatRun> = {}): ChatRun {
  return {
    id: "run-1",
    sessionId: "session-1",
    pendingPrompt: "帮我写个排序",
    tools: [],
    timeline: [],
    text: "完成",
    thinking: "",
    retry: null,
    runId: "run-1",
    error: "",
    queued: { steering: [], followUp: [] },
    stopping: false,
    tokenSpeed: 0,
    isStreaming: false,
    startedAt: 1000,
    finishedAt: 2000,
    ...overrides,
  };
}

describe("planCompletionNotices", () => {
  it("schedules a toast on success when page is visible in 'both' mode", () => {
    const notices = planCompletionNotices([finishedRun()], "both", true);
    expect(notices).toEqual([
      expect.objectContaining({ runId: "run-1", ok: true, title: "任务已完成", via: "toast" }),
    ]);
    expect(notices[0].detail).toBe("帮我写个排序");
  });

  it("schedules a desktop notification on success when page is hidden in 'both' mode", () => {
    const notices = planCompletionNotices([finishedRun()], "both", false);
    expect(notices[0]).toEqual(expect.objectContaining({ runId: "run-1", ok: true, via: "desktop" }));
  });

  it("reports failure with the error message", () => {
    const run = finishedRun({ error: "请求失败（HTTP 500）。" });
    const notices = planCompletionNotices([run], "page", true);
    expect(notices[0]).toEqual(expect.objectContaining({
      ok: false,
      title: "任务执行失败",
      detail: "请求失败（HTTP 500）。",
      via: "toast",
    }));
  });

  it("ignores still-streaming runs and runs without finishedAt", () => {
    const streaming = finishedRun({ id: "a", isStreaming: true, finishedAt: null });
    const notFinished = finishedRun({ id: "b", finishedAt: null });
    expect(planCompletionNotices([streaming, notFinished], "both", true)).toEqual([]);
  });

  it("ignores user-stopped runs", () => {
    const stopped = finishedRun({ stopping: true, error: "已停止。" });
    expect(planCompletionNotices([stopped], "both", true)).toEqual([]);
  });

  it("ignores replayed runs restored after refresh", () => {
    const replay = finishedRun({ replay: true });
    expect(planCompletionNotices([replay], "both", true)).toEqual([]);
  });

  it("suppresses everything in 'off' mode", () => {
    expect(planCompletionNotices([finishedRun()], "off", true)).toEqual([]);
  });

  it("'desktop' mode only notifies when the page is hidden", () => {
    expect(planCompletionNotices([finishedRun()], "desktop", true)).toEqual([
      expect.objectContaining({ via: null }),
    ]);
    expect(planCompletionNotices([finishedRun()], "desktop", false)).toEqual([
      expect.objectContaining({ via: "desktop" }),
    ]);
  });

  it("'page' mode always uses toasts regardless of visibility", () => {
    expect(planCompletionNotices([finishedRun()], "page", false)[0].via).toBe("toast");
  });
});
