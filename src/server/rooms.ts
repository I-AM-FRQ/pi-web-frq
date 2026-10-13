import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { deleteProjectPersistentSession } from "@/server/session-workspaces";

/**
 * 聊天室（多模型协作房间）。
 *
 * 设计要点：
 * - 每个参与者（角色）持有一个独立的持久 pi 会话，因此“点角色名进入”能看到该角色的完整输出，也能单独对话。
 * - 角色只是角色（名称），底层模型由 modelKey 指定并可在运行中随时更换——换模型不改变上下文（会话历史保留）。
 * - 群聊消息对房间内所有参与者可见（visibility=room）；私聊消息只注入目标参与者（visibility=private）。
 * - 会话在角色首次响应时创建（pi 的持久会话是懒落盘的，预创建会导致随后 open 失败）。
 */

export type RoomParticipant = {
  id: string;
  /** 角色名，例如“开发者”“审查者”。角色与模型解耦。 */
  role: string;
  /** 角色卡：预设提示词，每次该角色被触发时都会注入（约束它的职责、风格与边界）。 */
  rolePrompt?: string;
  /** 当前使用的模型，"provider:id"。可随时更换，会话上下文不受影响。 */
  modelKey: string;
  /** 该角色独立的持久会话 id；空字符串表示尚未开始（会话在首次响应时创建）。 */
  sessionId: string;
  createdAt: string;
};

export type Room = {
  id: string;
  projectId: string | null;
  name: string;
  participants: RoomParticipant[];
  createdAt: string;
  updatedAt: string;
};

export type RoomMessageSender =
  | { type: "user" }
  | { type: "participant"; participantId: string; role: string };

export type RoomMessage = {
  id: string;
  roomId: string;
  sender: RoomMessageSender;
  content: string;
  /** room：房间公开；private：仅目标参与者可见。 */
  visibility: "room" | "private";
  targetParticipantId?: string;
  createdAt: string;
};

type RoomRegistry = { rooms: Room[] };

const ROOMS_PATH = process.env.PI_WEB_ROOMS_PATH || join(homedir(), ".pi", "agent", "workbench", "rooms.json");
const MESSAGES_DIR = join(dirname(ROOMS_PATH), "room-messages");
const ROOM_ID_PATTERN = /^room-[a-z0-9-]{4,80}$/;
const PARTICIPANT_ID_PATTERN = /^participant-[a-z0-9-]{4,80}$/;
const MODEL_KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}:[A-Za-z0-9._:/-]{1,200}$/;
const MAX_ROLE_LENGTH = 40;
/** 角色卡（预设提示词）上限：每轮都会注入，过长会持续吃上下文。 */
export const MAX_ROLE_PROMPT_LENGTH = 4_000;
const MAX_PARTICIPANTS = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;

let writeQueue: Promise<void> = Promise.resolve();

function messagesFileFor(roomId: string) {
  return join(MESSAGES_DIR, `${roomId}.jsonl`);
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("房间名称必须是文本。");
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) throw new Error("房间名称长度需为 1 到 80 个字符。");
  return name;
}

export function normalizeRole(value: unknown): string {
  if (typeof value !== "string") throw new Error("角色名必须是文本。");
  const role = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (role.length < 1 || role.length > MAX_ROLE_LENGTH) throw new Error(`角色名长度需为 1 到 ${MAX_ROLE_LENGTH} 个字符。`);
  return role;
}

export function normalizeRolePrompt(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("角色卡必须是文本。");
  const prompt = value.replace(/\r\n/g, "\n").trim();
  if (!prompt) return undefined;
  if (prompt.length > MAX_ROLE_PROMPT_LENGTH) throw new Error(`角色卡过长（上限 ${MAX_ROLE_PROMPT_LENGTH} 字符）。`);
  return prompt;
}

export function normalizeModelKey(value: unknown): string {
  if (typeof value !== "string" || !MODEL_KEY_PATTERN.test(value.trim())) {
    throw new Error('模型标识格式应为 "provider:model"。');
  }
  return value.trim();
}

export function normalizeMessageContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("消息内容必须是文本。");
  const content = value.trim();
  if (!content) throw new Error("消息内容不能为空。");
  if (Buffer.byteLength(content, "utf8") > MAX_MESSAGE_BYTES) throw new Error("消息过长（上限 64 KiB）。");
  return content;
}

export function validRoomId(value: string): boolean {
  return ROOM_ID_PATTERN.test(value);
}

export function validParticipantId(value: string): boolean {
  return PARTICIPANT_ID_PATTERN.test(value);
}

async function readRegistry(): Promise<RoomRegistry> {
  try {
    const raw = JSON.parse(await readFile(ROOMS_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as RoomRegistry).rooms)) return { rooms: [] };
    const rooms = (raw as RoomRegistry).rooms.filter((room): room is Room => Boolean(room) && typeof room === "object" && typeof (room as Room).id === "string");
    return { rooms };
  } catch {
    return { rooms: [] };
  }
}

/** 串行写：避免并发创建/更新互相覆盖。 */
function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function writeRegistry(registry: RoomRegistry): Promise<void> {
  await mkdir(dirname(ROOMS_PATH), { recursive: true });
  const temporary = `${ROOMS_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temporary, ROOMS_PATH);
}

export async function listRooms(projectId?: string | null): Promise<Room[]> {
  const registry = await readRegistry();
  const rooms = projectId === undefined
    ? registry.rooms
    : registry.rooms.filter((room) => (room.projectId ?? null) === (projectId ?? null));
  return rooms.map((room) => ({ ...room, participants: [...room.participants] }));
}

export async function getRoom(roomId: string): Promise<Room | undefined> {
  if (!validRoomId(roomId)) return undefined;
  const registry = await readRegistry();
  const room = registry.rooms.find((candidate) => candidate.id === roomId);
  return room ? { ...room, participants: [...room.participants] } : undefined;
}

/**
 * 所有聊天室角色持有的会话 id。
 * 这些会话属于房间（通过房间视图访问），不应在普通会话列表里单独展示。
 */
export async function listRoomParticipantSessionIds(): Promise<Set<string>> {
  const registry = await readRegistry();
  const ids = new Set<string>();
  for (const room of registry.rooms) {
    for (const participant of room.participants) {
      if (participant.sessionId) ids.add(participant.sessionId);
    }
  }
  return ids;
}

export type CreateRoomInput = {
  projectId?: string | null;
  name: string;
  /** 初始参与者：角色名 + 模型（模型后续可改）+ 可选角色卡。 */
  roles: Array<{ role: string; modelKey: string; rolePrompt?: string }>;
};

export async function createRoom(input: CreateRoomInput): Promise<Room> {
  const name = normalizeName(input.name);
  if (!Array.isArray(input.roles) || input.roles.length === 0) throw new Error("聊天室至少需要一个角色。");
  if (input.roles.length > MAX_PARTICIPANTS) throw new Error(`聊天室最多支持 ${MAX_PARTICIPANTS} 个角色。`);
  const roles = input.roles.map((item) => ({
    role: normalizeRole(item.role),
    modelKey: normalizeModelKey(item.modelKey),
    rolePrompt: normalizeRolePrompt(item.rolePrompt),
  }));
  const names = new Set(roles.map((item) => item.role));
  if (names.size !== roles.length) throw new Error("角色名不能重复。");

  const now = new Date().toISOString();
  const participants: RoomParticipant[] = roles.map((item) => ({
    id: `participant-${randomUUID().slice(0, 8)}`,
    role: item.role,
    ...(item.rolePrompt ? { rolePrompt: item.rolePrompt } : {}),
    modelKey: item.modelKey,
    sessionId: "",
    createdAt: now,
  }));
  const room: Room = {
    id: `room-${randomUUID().slice(0, 8)}`,
    projectId: input.projectId ?? null,
    name,
    participants,
    createdAt: now,
    updatedAt: now,
  };
  await enqueueWrite(async () => {
    const registry = await readRegistry();
    registry.rooms.push(room);
    await writeRegistry(registry);
  });
  return room;
}

export async function renameRoom(roomId: string, name: string): Promise<Room> {
  const normalized = normalizeName(name);
  return updateRoom(roomId, (room) => ({ ...room, name: normalized }));
}

async function updateRoom(roomId: string, mutate: (room: Room) => Room): Promise<Room> {
  const room = await getRoom(roomId);
  if (!room) throw new Error("聊天室不存在。");
  let updated: Room = room;
  await enqueueWrite(async () => {
    const registry = await readRegistry();
    const index = registry.rooms.findIndex((candidate) => candidate.id === roomId);
    if (index === -1) throw new Error("聊天室不存在。");
    updated = { ...mutate(registry.rooms[index]), updatedAt: new Date().toISOString() };
    registry.rooms[index] = updated;
    await writeRegistry(registry);
  });
  return updated;
}

export async function deleteRoom(roomId: string): Promise<void> {
  const room = await getRoom(roomId);
  await enqueueWrite(async () => {
    const registry = await readRegistry();
    const next = registry.rooms.filter((candidate) => candidate.id !== roomId);
    if (next.length === registry.rooms.length) throw new Error("聊天室不存在。");
    registry.rooms = next;
    await writeRegistry(registry);
  });
  // 一并删除角色会话，避免留下无法访问的孤儿会话。
  for (const participant of room?.participants ?? []) {
    if (!participant.sessionId) continue;
    await deleteProjectPersistentSession(participant.sessionId).catch((error) => {
      console.error("Unable to delete room participant session", error);
    });
  }
}

export async function addParticipant(roomId: string, input: { role: string; modelKey: string; rolePrompt?: string }): Promise<Room> {
  const role = normalizeRole(input.role);
  const rolePrompt = normalizeRolePrompt(input.rolePrompt);
  const modelKey = normalizeModelKey(input.modelKey);
  const existing = await getRoom(roomId);
  if (!existing) throw new Error("聊天室不存在。");
  if (existing.participants.length >= MAX_PARTICIPANTS) throw new Error(`聊天室最多支持 ${MAX_PARTICIPANTS} 个角色。`);
  if (existing.participants.some((participant) => participant.role === role)) throw new Error("角色名不能重复。");
  const participant: RoomParticipant = {
    id: `participant-${randomUUID().slice(0, 8)}`,
    role,
    ...(rolePrompt ? { rolePrompt } : {}),
    modelKey,
    sessionId: "",
    createdAt: new Date().toISOString(),
  };
  return updateRoom(roomId, (room) => ({ ...room, participants: [...room.participants, participant] }));
}

/** 更新参与者：改角色名、更换模型（换模型不改变会话上下文）或修改角色卡。 */
export async function updateParticipant(roomId: string, participantId: string, patch: { role?: string; modelKey?: string; rolePrompt?: string | null }): Promise<Room> {
  if (!validParticipantId(participantId)) throw new Error("参与者无效。");
  const role = patch.role === undefined ? undefined : normalizeRole(patch.role);
  const modelKey = patch.modelKey === undefined ? undefined : normalizeModelKey(patch.modelKey);
  const rolePrompt = patch.rolePrompt === undefined ? undefined : normalizeRolePrompt(patch.rolePrompt);
  const clearRolePrompt = patch.rolePrompt === null;
  if (role === undefined && modelKey === undefined && rolePrompt === undefined && !clearRolePrompt) throw new Error("没有需要更新的字段。");
  return updateRoom(roomId, (room) => {
    const participants = room.participants.map((participant) => {
      if (participant.id !== participantId) return participant;
      const next: RoomParticipant = { ...participant };
      if (role !== undefined) next.role = role;
      if (modelKey !== undefined) next.modelKey = modelKey;
      if (clearRolePrompt) delete next.rolePrompt;
      else if (rolePrompt !== undefined) next.rolePrompt = rolePrompt;
      return next;
    });
    if (!participants.some((participant) => participant.id === participantId)) throw new Error("参与者不存在。");
    if (role !== undefined && participants.filter((participant) => participant.role === role).length > 1) throw new Error("角色名不能重复。");
    return { ...room, participants };
  });
}

/** 记录角色首次响应时创建出来的会话 id（懒创建）。 */
export async function setParticipantSession(roomId: string, participantId: string, sessionId: string): Promise<Room> {
  if (!validParticipantId(participantId)) throw new Error("参与者无效。");
  if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("会话标识无效。");
  return updateRoom(roomId, (room) => {
    const participants = room.participants.map((participant) => participant.id === participantId ? { ...participant, sessionId } : participant);
    if (!participants.some((participant) => participant.id === participantId)) throw new Error("参与者不存在。");
    return { ...room, participants };
  });
}

export async function removeParticipant(roomId: string, participantId: string): Promise<Room> {
  if (!validParticipantId(participantId)) throw new Error("参与者无效。");
  const room = await getRoom(roomId);
  if (!room) throw new Error("聊天室不存在。");
  if (room.participants.length <= 1) throw new Error("聊天室至少需要保留一个角色。");
  return updateRoom(roomId, (current) => {
    const participants = current.participants.filter((participant) => participant.id !== participantId);
    if (participants.length === current.participants.length) throw new Error("参与者不存在。");
    return { ...current, participants };
  });
}

function parseMessageLine(line: string): RoomMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as RoomMessage;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || typeof parsed.content !== "string") return undefined;
    return parsed;
  } catch {
    // 允许存在损坏行（例如写入过程中断电），跳过而不影响其余消息
    return undefined;
  }
}

export async function listRoomMessages(roomId: string, limit = 500): Promise<RoomMessage[]> {
  if (!validRoomId(roomId)) return [];
  let raw: string;
  try {
    raw = await readFile(messagesFileFor(roomId), "utf8");
  } catch {
    return [];
  }
  const messages = raw.split("\n").map(parseMessageLine).filter((message): message is RoomMessage => Boolean(message));
  return messages.slice(-Math.max(1, Math.min(limit, 2000)));
}

export type AppendRoomMessageInput = {
  roomId: string;
  sender: RoomMessageSender;
  content: string;
  visibility?: "room" | "private";
  targetParticipantId?: string;
};

export async function appendRoomMessage(input: AppendRoomMessageInput): Promise<RoomMessage> {
  const content = normalizeMessageContent(input.content);
  const visibility = input.visibility ?? "room";
  if (visibility === "private" && !input.targetParticipantId) throw new Error("私聊消息必须指定目标参与者。");
  const message: RoomMessage = {
    id: `msg-${randomUUID().slice(0, 12)}`,
    roomId: input.roomId,
    sender: input.sender,
    content,
    visibility,
    ...(visibility === "private" ? { targetParticipantId: input.targetParticipantId } : {}),
    createdAt: new Date().toISOString(),
  };
  await mkdir(MESSAGES_DIR, { recursive: true });
  await appendFile(messagesFileFor(input.roomId), `${JSON.stringify(message)}\n`, "utf8");
  return message;
}
