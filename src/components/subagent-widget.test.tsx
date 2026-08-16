import { describe, expect, it } from "vitest";
import { taskEventsToRuntimeTimeline } from "@/components/subagent-widget";
import type { TaskEvent } from "@/client/use-running-subagents";

const event = (seq: number, kind: TaskEvent["kind"], data: TaskEvent["data"]): TaskEvent => ({ seq, ts: seq, kind, data });

describe("taskEventsToRuntimeTimeline", () => {
  it("merges content and delta text chunks into one current reply", () => {
    const items = taskEventsToRuntimeTimeline([
      event(1, "text", { content: "hello " }),
      event(2, "text", { delta: "world" }),
    ], "running");
    expect(items).toEqual([{ kind: "text", text: "hello world", isError: undefined }]);
  });

  it("maps running and completed tools to the shared tool contract", () => {
    const items = taskEventsToRuntimeTimeline([
      event(1, "tool", { name: "shell", label: "shell · ls", running: true }),
      event(2, "tool", { name: "read", label: "read", result: "ok", isError: false, running: false }),
    ], "running");
    expect(items[0]).toMatchObject({ kind: "tool", name: "shell", running: true });
    expect(items[1]).toMatchObject({ kind: "tool", name: "read", result: "ok", running: false });
  });

  it.each(["done", "failed", "killed", "timeout"])("marks all tools complete when the task reaches terminal status %s", (status) => {
    const items = taskEventsToRuntimeTimeline([event(1, "tool", { name: "shell", label: "shell" })], status);
    expect(items[0]).toMatchObject({ kind: "tool", running: false });
  });

  it("keeps status events as status items instead of assistant markdown", () => {
    const items = taskEventsToRuntimeTimeline([event(1, "status", { status: "正在收尾" })], "running");
    expect(items).toEqual([{ kind: "status", text: "正在收尾", isError: undefined }]);
  });
});
