export type FrqTaskSessionMode = "persistent" | "ephemeral";

export type FrqTaskStatus = "pending" | "queued" | "running" | "done" | "failed" | "killed" | "timeout";

export type FrqTaskEventKind = "thinking" | "text" | "tool" | "status";

export type FrqTaskEvent = {
  seq: number;
  ts: number;
  kind: FrqTaskEventKind;
  data: Record<string, unknown>;
};

export type TaskState = {
  taskId: string;
  task?: string;
  // The subagent-frq extension must set this when it creates a task. Older
  // brokers may use ownerSessionId, which remains an equivalent association.
  sessionId?: string;
  ownerSessionId?: string;
  nickname: string;
  agentName: string;
  agentSource: "user" | "project";
  model: string;
  sessionMode: FrqTaskSessionMode;
  status: FrqTaskStatus;
  startTime: number;
  finishTime: number | null;
  errorMessage: string | null;
  outputs: string[];
  actions: string[];
  events: FrqTaskEvent[];
};

export type FrqBroker = {
  listTasks(): TaskState[];
  subscribe(listener: (update: { task: TaskState }) => void): () => void;
};

export type FrqTaskSnapshot = Omit<TaskState, "sessionId" | "ownerSessionId">;

type FrqGlobal = typeof globalThis & { __piFrqBroker?: unknown };

function isFrqBroker(value: unknown): value is FrqBroker {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { listTasks?: unknown; subscribe?: unknown };
  return typeof candidate.listTasks === "function" && typeof candidate.subscribe === "function";
}

export function getFrqBroker(): FrqBroker | null {
  const broker = (globalThis as FrqGlobal).__piFrqBroker;
  return isFrqBroker(broker) ? broker : null;
}

/** Applies the same ownership rule to snapshots and broker subscription updates. */
export function taskBelongsToSession(task: Pick<TaskState, "sessionId" | "ownerSessionId">, sessionId: string): boolean {
  return (task.sessionId ?? task.ownerSessionId) === sessionId;
}

export function tasksForSession(sessionId: string): TaskState[] {
  const broker = getFrqBroker();
  if (!broker) return [];
  return broker.listTasks().filter((task) => taskBelongsToSession(task, sessionId));
}

export function taskSnapshot(task: TaskState): FrqTaskSnapshot {
  return {
    taskId: task.taskId,
    task: task.task,
    nickname: task.nickname,
    agentName: task.agentName,
    agentSource: task.agentSource,
    model: task.model,
    sessionMode: task.sessionMode,
    status: task.status,
    startTime: task.startTime,
    finishTime: task.finishTime,
    errorMessage: task.errorMessage,
    outputs: [...task.outputs],
    actions: [...task.actions],
    events: task.events.map((event) => ({ ...event, data: { ...event.data } })),
  };
}
