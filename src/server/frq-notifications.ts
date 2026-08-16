import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { workspaceForSession } from "@/server/session-workspaces";

export type FrqCompletionStatus = "done" | "failed" | "killed" | "timeout";

export type FrqCompletionNotification = {
  id: string;
  sessionId: string;
  taskId: string;
  nickname: string;
  status: FrqCompletionStatus;
  summary: string;
  createdAt: number;
  uiAcknowledgedAt: number | null;
  modelDeliveredAt: number | null;
};

export type FrqNotificationCursor = {
  completionsOffset: number;
  completionsTrailing: string;
  acksOffset: number;
  acksTrailing: string;
  acknowledgedIds: Set<string>;
};
export type FrqNotificationRead = { notifications: FrqCompletionNotification[]; cursor: FrqNotificationCursor };

const BUS_DIR = ".agent-bus";
const COMPLETIONS_FILE = "frq-completions.jsonl";
const ACKS_FILE = "frq-completion-ui-acks.jsonl";
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function lines(text: string): string[] {
  return text.split(LF).map((line) => line.endsWith(CR) ? line.slice(0, -1) : line).filter((line) => line.trim());
}

function parseCompletions(text: string, sessionId: string): FrqCompletionNotification[] {
  const result: FrqCompletionNotification[] = [];
  for (const line of lines(text)) {
    const value = JSON.parse(line) as Partial<FrqCompletionNotification>;
    if (typeof value.id !== "string" || value.sessionId !== sessionId || typeof value.taskId !== "string"
      || typeof value.nickname !== "string" || typeof value.summary !== "string" || typeof value.createdAt !== "number"
      || !["done", "failed", "killed", "timeout"].includes(String(value.status))) continue;
    result.push(value as FrqCompletionNotification);
  }
  return result;
}

function parseAcknowledgements(text: string, sessionId: string): string[] {
  const result: string[] = [];
  for (const line of lines(text)) {
    const value = JSON.parse(line) as { id?: unknown; sessionId?: unknown };
    if (typeof value.id === "string" && value.sessionId === sessionId) result.push(value.id);
  }
  return result;
}

async function notificationPaths(sessionId: string) {
  const workspace = await workspaceForSession(sessionId);
  const dir = join(workspace, BUS_DIR);
  return { dir, completions: join(dir, COMPLETIONS_FILE), acks: join(dir, ACKS_FILE) };
}

async function readAppended(file: string, offset: number, trailing: string): Promise<{ complete: string; offset: number; trailing: string }> {
  let handle;
  try {
    handle = await open(file, "r");
    const metadata = await handle.stat();
    const reset = metadata.size < offset;
    const nextOffset = reset ? 0 : offset;
    const nextTrailing = reset ? "" : trailing;
    if (metadata.size === nextOffset) return { complete: "", offset: nextOffset, trailing: nextTrailing };
    const bytes = Buffer.alloc(metadata.size - nextOffset);
    await handle.read(bytes, 0, bytes.length, nextOffset);
    const combined = nextTrailing + bytes.toString("utf8");
    const boundary = combined.lastIndexOf(LF);
    if (boundary < 0) return { complete: "", offset: metadata.size, trailing: combined };
    return { complete: combined.slice(0, boundary), offset: metadata.size, trailing: combined.slice(boundary + 1) };
  } catch (error) {
    if (isMissing(error)) return { complete: "", offset, trailing };
    throw error;
  } finally {
    await handle?.close();
  }
}

export function initialFrqNotificationCursor(): FrqNotificationCursor {
  return { completionsOffset: 0, completionsTrailing: "", acksOffset: 0, acksTrailing: "", acknowledgedIds: new Set() };
}

export async function readFrqCompletionNotifications(sessionId: string, cursor = initialFrqNotificationCursor()): Promise<FrqNotificationRead> {
  const { completions, acks } = await notificationPaths(sessionId);
  const [newAcks, newCompletions] = await Promise.all([
    readAppended(acks, cursor.acksOffset, cursor.acksTrailing),
    readAppended(completions, cursor.completionsOffset, cursor.completionsTrailing),
  ]);
  const acknowledgedIds = new Set(cursor.acknowledgedIds);
  for (const id of parseAcknowledgements(newAcks.complete, sessionId)) acknowledgedIds.add(id);
  const notifications = parseCompletions(newCompletions.complete, sessionId)
    .filter((notification) => !acknowledgedIds.has(notification.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  return {
    notifications,
    cursor: {
      completionsOffset: newCompletions.offset,
      completionsTrailing: newCompletions.trailing,
      acksOffset: newAcks.offset,
      acksTrailing: newAcks.trailing,
      acknowledgedIds,
    },
  };
}

export async function listFrqCompletionNotifications(sessionId: string): Promise<FrqCompletionNotification[]> {
  return (await readFrqCompletionNotifications(sessionId)).notifications;
}

export async function acknowledgeFrqCompletionNotifications(sessionId: string, ids: string[]): Promise<void> {
  const { dir, acks } = await notificationPaths(sessionId);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  await appendFile(acks, ids.map((id) => JSON.stringify({ id, sessionId, acknowledgedAt: now })).join(LF) + LF, "utf8");
}
