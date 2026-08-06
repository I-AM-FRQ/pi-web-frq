import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ChatStreamEvent } from "@/contracts";

type AbortableChatSession = {
  abort(): Promise<unknown> | unknown;
  steer?: (text: string, images?: ImageContent[]) => Promise<unknown> | unknown;
  followUp?: (text: string, images?: ImageContent[]) => Promise<unknown> | unknown;
  getContextUsage?: AgentSession["getContextUsage"];
  model?: AgentSession["model"];
  sessionManager?: AgentSession["sessionManager"];
};

type ActiveChatRun = {
  events: ChatStreamEvent[];
  session: AbortableChatSession;
  subscribers: Set<(event: ChatStreamEvent) => void>;
  stopRequested: boolean;
  completed: Promise<void>;
  resolveCompleted: () => void;
};

const ACTIVE_CHAT_RUNS_KEY = "__piWorkbenchActiveChatRuns";
const processState = globalThis as typeof globalThis & { [ACTIVE_CHAT_RUNS_KEY]?: Map<string, ActiveChatRun> };
const activeChatRuns = processState[ACTIVE_CHAT_RUNS_KEY] ?? (processState[ACTIVE_CHAT_RUNS_KEY] = new Map<string, ActiveChatRun>());
const MAX_REPLAY_EVENTS = 2_000;
const MAX_REPLAY_TEXT = 1_000_000;

function eventTextLength(event: ChatStreamEvent): number {
  return event.type === "text_delta" || event.type === "thinking_delta" ? event.delta.length : 0;
}

function appendReplayEvent(events: ChatStreamEvent[], event: ChatStreamEvent) {
  const last = events.at(-1);
  if (last?.type === "text_delta" && event.type === "text_delta") {
    events[events.length - 1] = { type: "text_delta", delta: last.delta + event.delta };
  } else if (last?.type === "thinking_delta" && event.type === "thinking_delta") {
    events[events.length - 1] = { type: "thinking_delta", delta: last.delta + event.delta };
  } else {
    events.push(event);
  }
  while (events.length > MAX_REPLAY_EVENTS || events.reduce((total, item) => total + eventTextLength(item), 0) > MAX_REPLAY_TEXT) {
    const removable = events.findIndex((item) => item.type !== "start");
    if (removable < 0) break;
    events.splice(removable, 1);
  }
}

export function registerActiveChatRun(sessionId: string, session: AbortableChatSession) {
  let resolveCompleted = () => {};
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve;
  });
  activeChatRuns.set(sessionId, { events: [], session, subscribers: new Set(), stopRequested: false, completed, resolveCompleted });
}

export function publishActiveChatRunEvent(sessionId: string, event: ChatStreamEvent) {
  const run = activeChatRuns.get(sessionId);
  if (!run) return;
  appendReplayEvent(run.events, event);
  for (const subscriber of run.subscribers) subscriber(event);
}

export function hasActiveChatRun(sessionId: string): boolean {
  return activeChatRuns.has(sessionId);
}

export function activeChatSession(sessionId: string): AbortableChatSession | undefined {
  return activeChatRuns.get(sessionId)?.session;
}

export function subscribeToActiveChatRun(sessionId: string, subscriber: (event: ChatStreamEvent) => void): (() => void) | undefined {
  const run = activeChatRuns.get(sessionId);
  if (!run) return undefined;
  for (const event of run.events) subscriber(event);
  run.subscribers.add(subscriber);
  return () => run.subscribers.delete(subscriber);
}

export function unregisterActiveChatRun(sessionId: string, session: AbortableChatSession) {
  const run = activeChatRuns.get(sessionId);
  if (run?.session !== session) return;
  run.resolveCompleted();
  activeChatRuns.delete(sessionId);
}

export function activeChatRunStopRequested(sessionId: string): boolean {
  return activeChatRuns.get(sessionId)?.stopRequested ?? false;
}

export async function abortActiveChatRun(sessionId: string): Promise<boolean> {
  const run = activeChatRuns.get(sessionId);
  if (!run) return false;
  run.stopRequested = true;
  await run.session.abort();
  await run.completed;
  return true;
}
