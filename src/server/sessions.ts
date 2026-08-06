import { rm } from "node:fs/promises";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@/contracts";
import { workspace } from "@/server/workspace";
import { visibleWorkspacePrompt } from "@/server/file-references";
import { redactLocalPaths } from "@/server/output-sanitization";
import { deleteSessionAttachments } from "@/server/attachments";

export class SessionNotFoundError extends Error {
  constructor() {
    super("Session not found.");
    this.name = "SessionNotFoundError";
  }
}

export class SessionEntryNotFoundError extends Error {
  constructor() {
    super("Session entry not found.");
    this.name = "SessionEntryNotFoundError";
  }
}

const SESSION_INDEX_TTL_MS = 60_000;
const sessionIndexes = new Map<string, { expiresAt: number; sessions: Map<string, SessionInfo> }>();

function sessionIndexKey(root: string) {
  return root.toLowerCase();
}

function indexSessions(root: string, sessions: SessionInfo[]) {
  sessionIndexes.set(sessionIndexKey(root), {
    expiresAt: Date.now() + SESSION_INDEX_TTL_MS,
    sessions: new Map(sessions.map((session) => [session.id, session])),
  });
}

export function invalidateSessionIndex(root = workspace) {
  sessionIndexes.delete(sessionIndexKey(root));
}

function baseSessionSummary(session: SessionInfo, firstMessage: string): SessionSummary {
  return {
    id: session.id,
    name: session.name ? redactLocalPaths(session.name) : undefined,
    createdAt: session.created.toISOString(),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: redactLocalPaths(firstMessage),
  };
}

function toSessionSummary(session: SessionInfo): SessionSummary {
  return baseSessionSummary(session, redactLocalPaths(visibleWorkspacePrompt(session.firstMessage)));
}

export function createPersistentSession(root = workspace): SessionManager {
  return SessionManager.create(root);
}

const RUN_STATUS_TAIL_BYTES = 256 * 1024;

// 只读取会话文件尾部若干字节，判断“最近一次执行是否完成”：
// 扫描最后一个 message 条目，若其角色为 assistant（已产出结果，含失败），视为执行完成；
// 若最后是 user（等待回复）或其他条目，则视为未完成。
async function hasCompletedRun(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    if (size === 0) return false;
    const start = Math.max(0, size - RUN_STATUS_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { type?: unknown; message?: { role?: unknown } };
        if (entry && entry.type === "message" && entry.message) {
          return entry.message.role === "assistant";
        }
      } catch {
        // 尾部截断或损坏的行直接跳过
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function listSessions(root = workspace): Promise<SessionSummary[]> {
  const sessions = await SessionManager.list(root);
  indexSessions(root, sessions);
  return Promise.all(sessions.map(async (session) => ({ ...toSessionSummary(session), completed: await hasCompletedRun(session.path) })));
}

async function findSession(sessionId: string, root = workspace): Promise<SessionInfo> {
  const cached = sessionIndexes.get(sessionIndexKey(root));
  const indexed = cached && cached.expiresAt > Date.now() ? cached.sessions.get(sessionId) : undefined;
  if (indexed) return indexed;
  const sessions = await SessionManager.list(root);
  indexSessions(root, sessions);
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) throw new SessionNotFoundError();
  return session;
}

export async function openPersistentSession(sessionId: string, root = workspace): Promise<SessionManager> {
  const session = await findSession(sessionId, root);
  return SessionManager.open(session.path, undefined, root);
}

export async function openPersistentSessionWithSummary(sessionId: string, root = workspace): Promise<{ sessionManager: SessionManager; session: SessionSummary }> {
  const session = await findSession(sessionId, root);
  return { sessionManager: SessionManager.open(session.path, undefined, root), session: toSessionSummary(session) };
}

export function branchPersistentSession(sessionManager: SessionManager, entryId: string): void {
  const entry = sessionManager.getEntry(entryId);
  if (!entry || entry.type !== "message" || entry.message.role !== "user") throw new SessionEntryNotFoundError();

  // Editing replaces the selected user message. Branching *from* that entry would retain it
  // in the active path and append the edited prompt as a duplicate child.
  if (entry.parentId) sessionManager.branch(entry.parentId);
  else sessionManager.resetLeaf();
}


export async function getSessionSummary(sessionId: string, root = workspace): Promise<SessionSummary> {
  return toSessionSummary(await findSession(sessionId, root));
}

export async function deletePersistentSession(sessionId: string, root = workspace): Promise<void> {
  const session = await findSession(sessionId, root);
  await rm(session.path, { force: true });
  invalidateSessionIndex(root);
  await deleteSessionAttachments(sessionId, join(root, ".pi-web-attachments"));
}

function forkName(sourceName: string): string {
  const normalized = sourceName
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "未命名会话";
  return `副本：${normalized}`.slice(0, 120);
}

export async function forkPersistentSession(sessionId: string, entryId?: string, root = workspace): Promise<SessionSummary> {
  const session = await findSession(sessionId, root);
  const source = SessionManager.open(session.path, undefined, root);
  let fork: SessionManager;
  if (entryId) {
    const entry = source.getEntry(entryId);
    if (!entry || entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
      throw new SessionEntryNotFoundError();
    }
    const file = source.createBranchedSession(entryId);
    if (!file) throw new Error("Unable to create a persistent session branch.");
    fork = SessionManager.open(file, undefined, root);
  } else {
    fork = SessionManager.forkFrom(session.path, root);
  }
  fork.appendSessionInfo(forkName((await toSessionSummary(session)).name ?? session.firstMessage));
  invalidateSessionIndex(root);
  return getSessionSummary(fork.getSessionId(), root);
}
