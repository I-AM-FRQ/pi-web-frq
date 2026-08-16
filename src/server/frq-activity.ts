import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { workspaceForSession } from "@/server/session-workspaces";

export type FrqSessionActivityType = "run-start" | "run-end";

export type FrqSessionActivity = {
  id: string;
  sessionId: string;
  type: FrqSessionActivityType;
  createdAt: number;
};

export type FrqActivityCursor = { offset: number; trailing: string };
export type FrqActivityRead = { activities: FrqSessionActivity[]; cursor: FrqActivityCursor };

const BUS_DIR = ".agent-bus";
const ACTIVITY_FILE = "session-activity.jsonl";
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function parseActivities(text: string, sessionId: string): FrqSessionActivity[] {
  const result: FrqSessionActivity[] = [];
  for (const line of text.split(LF).map((entry) => entry.endsWith(CR) ? entry.slice(0, -1) : entry)) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as Partial<FrqSessionActivity>;
    if (typeof value.id !== "string" || value.sessionId !== sessionId || typeof value.createdAt !== "number"
      || !["run-start", "run-end"].includes(String(value.type))) continue;
    result.push(value as FrqSessionActivity);
  }
  return result;
}

async function activityPath(sessionId: string) {
  const workspace = await workspaceForSession(sessionId);
  const dir = join(workspace, BUS_DIR);
  return { dir, activity: join(dir, ACTIVITY_FILE) };
}

async function readAppended(file: string, cursor: FrqActivityCursor): Promise<{ complete: string; cursor: FrqActivityCursor }> {
  let handle;
  try {
    handle = await open(file, "r");
    const metadata = await handle.stat();
    const reset = metadata.size < cursor.offset;
    const offset = reset ? 0 : cursor.offset;
    const trailing = reset ? "" : cursor.trailing;
    if (metadata.size === offset) return { complete: "", cursor: { offset, trailing } };
    const bytes = Buffer.alloc(metadata.size - offset);
    await handle.read(bytes, 0, bytes.length, offset);
    const combined = trailing + bytes.toString("utf8");
    const boundary = combined.lastIndexOf(LF);
    if (boundary < 0) return { complete: "", cursor: { offset: metadata.size, trailing: combined } };
    return { complete: combined.slice(0, boundary), cursor: { offset: metadata.size, trailing: combined.slice(boundary + 1) } };
  } catch (error) {
    if (isMissing(error)) return { complete: "", cursor };
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readFrqSessionActivities(sessionId: string, cursor: FrqActivityCursor = { offset: 0, trailing: "" }): Promise<FrqActivityRead> {
  const { activity } = await activityPath(sessionId);
  const appended = await readAppended(activity, cursor);
  return { activities: parseActivities(appended.complete, sessionId).sort((a, b) => a.createdAt - b.createdAt), cursor: appended.cursor };
}

export async function listFrqSessionActivities(sessionId: string): Promise<FrqSessionActivity[]> {
  return (await readFrqSessionActivities(sessionId)).activities;
}

export async function recordFrqSessionActivity(sessionId: string, type: FrqSessionActivityType): Promise<FrqSessionActivity> {
  const entry: FrqSessionActivity = {
    id: `${Date.now()}-${crypto.randomUUID()}`,
    sessionId,
    type,
    createdAt: Date.now(),
  };
  const { dir, activity } = await activityPath(sessionId);
  await mkdir(dir, { recursive: true });
  await appendFile(activity, JSON.stringify(entry) + LF, "utf8");
  return entry;
}
