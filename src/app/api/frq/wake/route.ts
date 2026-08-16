import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { getAvailableModels, createChatSession } from "@/server/pi";
import { openProjectPersistentSession, workspaceForSession } from "@/server/session-workspaces";
import { tryLockSession } from "@/server/session-lock";
import { invalidateSessionIndex } from "@/server/sessions";
import { recordFrqSessionActivity } from "@/server/frq-activity";
import { activeChatSession, publishActiveChatRunEvent, registerActiveChatRun, unregisterActiveChatRun } from "@/server/active-chat-runs";
import { backgroundWakeMessage, userMessageStreamEvent } from "@/server/chat-user-message";
import { sanitizeSubagentDetails, toolResultText, toolStepLabel } from "@/server/session-projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SUMMARY_BYTES = 200 * 1024;
const BUS_DIR = ".agent-bus";
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2_000;

type WakeStatus = "queued" | "running" | "delivered" | "failed";
type WakeRecord = { taskId: string; status: WakeStatus; updatedAt: number; reason?: string };

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function validTaskId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value);
}

function wakeTokenMatches(request: NextRequest): boolean {
  const expected = process.env.PI_FRQ_WAKE_TOKEN;
  return Boolean(expected) && request.headers.get("x-pi-frq-wake-token") === expected;
}

function assistantVisibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function assistantThinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; thinking?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking)
    .join("");
}

function publishWakeSessionEvent(sessionId: string, event: AgentSessionEvent, streamed: { assistantText: string; thinkingText: string }) {
  if (event.type === "tool_execution_start") {
    publishActiveChatRunEvent(sessionId, { type: "tool_start", id: event.toolCallId, name: event.toolName, label: toolStepLabel(event.toolName, event.args) });
  }
  if (event.type === "tool_execution_update") {
    const details = sanitizeSubagentDetails((event.partialResult as { details?: unknown } | undefined)?.details);
    if (details) publishActiveChatRunEvent(sessionId, { type: "tool_update", id: event.toolCallId, details });
  }
  if (event.type === "tool_execution_end") {
    const details = sanitizeSubagentDetails((event.result as { details?: unknown } | undefined)?.details);
    publishActiveChatRunEvent(sessionId, {
      type: "tool_end",
      id: event.toolCallId,
      result: toolResultText(event.result),
      isError: event.isError,
      ...(details ? { details } : {}),
    });
  }
  if (event.type === "auto_retry_start") publishActiveChatRunEvent(sessionId, { type: "retry_scheduled", attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage });
  if (event.type === "auto_retry_end") publishActiveChatRunEvent(sessionId, { type: "retry_finished", success: event.success, attempt: event.attempt, message: event.finalError });
  if (event.type === "queue_update") publishActiveChatRunEvent(sessionId, { type: "queue_update", steering: event.steering, followUp: event.followUp });
  if (event.type === "message_start") {
    streamed.assistantText = "";
    streamed.thinkingText = "";
    const userMessage = userMessageStreamEvent(event.message);
    if (userMessage) publishActiveChatRunEvent(sessionId, userMessage);
  }
  if (event.type === "message_update") {
    const message = event.message;
    if (message.role !== "assistant") return;
    const thinking = assistantThinkingText(message.content);
    if (thinking.length > streamed.thinkingText.length) {
      publishActiveChatRunEvent(sessionId, { type: "thinking_delta", delta: thinking.slice(streamed.thinkingText.length) });
      streamed.thinkingText = thinking;
    }
    if (Array.isArray(message.content) && message.content.some((part) => (part as { type?: string }).type === "tool_call")) {
      streamed.assistantText = "";
      return;
    }
    const text = assistantVisibleText(message.content);
    if (text.length > streamed.assistantText.length) {
      publishActiveChatRunEvent(sessionId, { type: "text_delta", delta: text.slice(streamed.assistantText.length) });
      streamed.assistantText = text;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function withWakeTaskLock<T>(dir: string, key: string, action: () => Promise<T>): Promise<T> {
  const lock = join(dir, `frq-wake-${key}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let handle;
  while (!handle) {
    try {
      handle = await open(lock, "wx");
    } catch (error) {
      if (!isAlreadyExists(error) || Date.now() >= deadline) throw new Error("Timed out acquiring FRQ wake task lock.");
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    try { await unlink(lock); } catch (error) { if (!isMissing(error)) console.error("Unable to remove FRQ wake lock", error); }
  }
}

async function readWakeRecord(file: string): Promise<WakeRecord | null> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch (error) { if (isMissing(error)) return null; throw error; }
  let record: WakeRecord | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<WakeRecord>;
      if (typeof value.taskId === "string" && ["queued", "running", "delivered", "failed"].includes(String(value.status)) && typeof value.updatedAt === "number") record = value as WakeRecord;
    } catch {
      // A concurrent append may leave an incomplete final line; keep the last complete state.
    }
  }
  return record;
}

async function appendWakeRecord(file: string, taskId: string, status: WakeStatus, reason?: string): Promise<WakeRecord> {
  const record: WakeRecord = { taskId, status, updatedAt: Date.now(), ...(reason ? { reason } : {}) };
  await writeFile(file, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
  return record;
}

function statusResponse(record: WakeRecord): NextResponse {
  if (record.status === "delivered") return NextResponse.json({ accepted: true, delivered: true, replayed: true }, { headers: { "Cache-Control": "no-store" } });
  if (record.status === "failed") return NextResponse.json({ accepted: false, reason: record.reason ?? "wake_failed", replayed: true }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ accepted: true, queued: true, replayed: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

async function parseLimitedJson(request: NextRequest): Promise<{ body?: { sessionId?: unknown; taskId?: unknown; summary?: unknown }; error?: NextResponse }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return { error: NextResponse.json({ error: { code: "payload_too_large", message: "Request body exceeds 256 KiB." } }, { status: 413 }) };
  }
  let text: string;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) return { error: NextResponse.json({ error: { code: "payload_too_large", message: "Request body exceeds 256 KiB." } }, { status: 413 }) };
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: NextResponse.json({ error: { code: "invalid_request", message: "Request body must be UTF-8 JSON." } }, { status: 400 }) };
  }
  try { return { body: JSON.parse(text) as { sessionId?: unknown; taskId?: unknown; summary?: unknown } }; } catch {
    return { error: NextResponse.json({ error: { code: "invalid_request", message: "Request body must be JSON." } }, { status: 400 }) };
  }
}

export async function POST(request: NextRequest) {
  if (!wakeTokenMatches(request)) return NextResponse.json({ error: { code: "forbidden", message: "Invalid FRQ wake token." } }, { status: 403 });
  const parsed = await parseLimitedJson(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body!;
  if (!validSessionId(body.sessionId) || !validTaskId(body.taskId) || typeof body.summary !== "string") {
    return NextResponse.json({ error: { code: "invalid_request", message: "sessionId, taskId, and summary are required." } }, { status: 400 });
  }
  const { sessionId, taskId } = body;
  const summaryBytes = Buffer.from(body.summary, "utf8");
  const summary = new TextDecoder().decode(summaryBytes.subarray(0, MAX_SUMMARY_BYTES));
  const backgroundText = backgroundWakeMessage(summary);
  const workspace = await workspaceForSession(sessionId);
  const busDir = join(workspace, BUS_DIR);
  const wakeKey = `${sessionId}-${taskId}`;
  const stateFile = join(busDir, `frq-wake-${wakeKey}.jsonl`);
  await mkdir(busDir, { recursive: true });

  let claimed = false;
  const claim = async (): Promise<WakeRecord> => withWakeTaskLock(busDir, wakeKey, async () => {
    const record = await readWakeRecord(stateFile);
    if (record) return record;
    claimed = true;
    return appendWakeRecord(stateFile, taskId, "queued");
  });
  const mark = async (status: WakeStatus, reason?: string) => {
    try {
      await withWakeTaskLock(busDir, wakeKey, () => appendWakeRecord(stateFile, taskId, status, reason));
    } catch (error) {
      console.error("Unable to persist FRQ wake task state", error);
    }
  };

  // An active AgentSession owns the session lock. Queue the wake on that same
  // session so it shares FIFO ordering with all other running-session input.
  const activeSession = activeChatSession(sessionId);
  if (activeSession) {
    try {
      const existing = await claim();
      if (!claimed) return statusResponse(existing);
    } catch (error) {
      console.error("Unable to claim FRQ wake task", error);
      return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
    }
    if (typeof activeSession.followUp !== "function") {
      await mark("failed", "wake_failed");
      return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
    }
    try {
      await activeSession.followUp(backgroundText);
      await mark("delivered");
      return NextResponse.json({ accepted: true, queued: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Unable to queue FRQ wake", error);
      await mark("failed", "wake_failed");
      return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
    }
  }

  const lock = tryLockSession(sessionId);
  if (!lock) {
    try {
      const existing = await withWakeTaskLock(busDir, wakeKey, () => readWakeRecord(stateFile));
      if (existing) return statusResponse(existing);
    } catch (error) {
      console.error("Unable to inspect FRQ wake task", error);
      return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
    }
    return NextResponse.json({ accepted: false, reason: "session_busy" }, { status: 409 });
  }

  try {
    try {
      const existing = await claim();
      if (!claimed) return statusResponse(existing);
    } catch (error) {
      console.error("Unable to claim FRQ wake task", error);
      return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
    }
    await mark("running");
    const [sessionManager, projectWorkspace, models] = await Promise.all([
      openProjectPersistentSession(sessionId),
      workspaceForSession(sessionId),
      getAvailableModels(),
    ]);
    const savedModel = sessionManager.buildSessionContext().model;
    const model = savedModel ? models.find((candidate) => candidate.provider === savedModel.provider && candidate.id === savedModel.modelId) ?? models[0] : models[0];
    if (!model) {
      await mark("failed", "model_unavailable");
      return NextResponse.json({ accepted: false, reason: "model_unavailable" }, { status: 503 });
    }
    const savedThinking = sessionManager.buildSessionContext().thinkingLevel;
    const thinking = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(savedThinking ?? "") ? savedThinking as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" : undefined;
    const { session } = await createChatSession(model, thinking, sessionManager, undefined, projectWorkspace);
    let unsubscribeSession = () => {};
    try {
      registerActiveChatRun(sessionId, session);
      try { await recordFrqSessionActivity(sessionId, "run-start"); } catch (error) { console.error("Unable to record FRQ run start", error); }
      const streamed = { assistantText: "", thinkingText: "" };
      unsubscribeSession = session.subscribe((event) => publishWakeSessionEvent(sessionId, event, streamed));
      publishActiveChatRunEvent(sessionId, { type: "start", runId: session.sessionId, sessionId, prompt: backgroundText, model: { provider: model.provider, id: model.id } });
      await session.prompt(backgroundText);
      publishActiveChatRunEvent(sessionId, { type: "done", sessionId });
    } catch (error) {
      console.error("FRQ wake prompt failed", error);
      publishActiveChatRunEvent(sessionId, { type: "error", code: "chat_failed", message: error instanceof Error ? error.message : "The chat run failed." });
      throw error;
    } finally {
      unsubscribeSession();
      unregisterActiveChatRun(sessionId, session);
      try { await recordFrqSessionActivity(sessionId, "run-end"); } catch (error) { console.error("Unable to record FRQ run end", error); }
      session.dispose();
      invalidateSessionIndex(projectWorkspace);
    }
    await mark("delivered");
    return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FRQ wake failed", error);
    await mark("failed", "wake_failed");
    return NextResponse.json({ accepted: false, reason: "wake_failed" }, { status: 500 });
  } finally {
    lock.release();
  }
}
