import { afterEach, describe, expect, it } from "vitest";
import { getFrqBroker, taskSnapshot, tasksForSession, type FrqBroker, type TaskState } from "./frq-tasks";

type FrqGlobal = typeof globalThis & { __piFrqBroker?: unknown };

const globalState = globalThis as FrqGlobal;
const originalBroker = globalState.__piFrqBroker;

function task(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: "task-1",
    sessionId: "session-a",
    nickname: "api-worker",
    agentName: "backend",
    agentSource: "user",
    model: "provider/model",
    sessionMode: "ephemeral",
    status: "running",
    startTime: 100,
    finishTime: null,
    errorMessage: null,
    outputs: ["output"],
    actions: ["action"],
    events: [{ seq: 1, ts: 101, kind: "text", data: { delta: "hello" } }],
    ...overrides,
  };
}

afterEach(() => {
  if (originalBroker === undefined) delete globalState.__piFrqBroker;
  else globalState.__piFrqBroker = originalBroker;
});

describe("FRQ task snapshots", () => {
  it("returns only stable public task fields", () => {
    const source = Object.assign(task(), { proc: { pid: 42 }, privateState: "hidden" });

    expect(taskSnapshot(source)).toEqual({
      taskId: "task-1",
      nickname: "api-worker",
      agentName: "backend",
      agentSource: "user",
      model: "provider/model",
      sessionMode: "ephemeral",
      status: "running",
      startTime: 100,
      finishTime: null,
      errorMessage: null,
      outputs: ["output"],
      actions: ["action"],
      events: [{ seq: 1, ts: 101, kind: "text", data: { delta: "hello" } }],
    });
    expect(taskSnapshot(source)).not.toHaveProperty("sessionId");
    expect(taskSnapshot(source)).not.toHaveProperty("proc");
  });
});

describe("tasksForSession", () => {
  it("uses the broker and returns only tasks explicitly owned by the session", () => {
    const matching = task();
    const otherSession = task({ taskId: "task-2", sessionId: "session-b" });
    const legacy = task({ taskId: "task-3", sessionId: undefined });
    const broker: FrqBroker = {
      listTasks: () => [matching, otherSession, legacy],
      subscribe: () => () => {},
    };
    globalState.__piFrqBroker = broker;

    expect(getFrqBroker()).toBe(broker);
    expect(tasksForSession("session-a")).toEqual([matching]);
  });

  it("accepts ownerSessionId when sessionId is absent", () => {
    const ownedByLegacyField = task({ sessionId: undefined, ownerSessionId: "session-a" });
    globalState.__piFrqBroker = {
      listTasks: () => [ownedByLegacyField],
      subscribe: () => () => {},
    };

    expect(tasksForSession("session-a")).toEqual([ownedByLegacyField]);
  });

  it("returns no tasks when a broker is unavailable or invalid", () => {
    globalState.__piFrqBroker = { listTasks: () => [] };
    expect(getFrqBroker()).toBeNull();
    expect(tasksForSession("session-a")).toEqual([]);
  });
});
