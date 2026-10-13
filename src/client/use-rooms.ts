"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, RoomMessage } from "@/contracts";

export type RoomDetail = { room: Room; messages: RoomMessage[] };

export type CreateRoomInput = {
  projectId: string | null;
  name: string;
  roles: Array<{ role: string; modelKey: string }>;
};

type RoomsState = {
  rooms: Room[];
  isLoading: boolean;
  error: string;
};

const DETAIL_POLL_MS = 1_500;

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 聊天室数据层：列表、详情（轮询，房间视图打开时保持新鲜）、消息发送、角色换模型。
 * 角色响应是异步的，因此详情用轮询而不是一次性拉取。
 */
export function useRooms() {
  const [state, setState] = useState<RoomsState>({ rooms: [], isLoading: false, error: "" });
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const selectedRoomIdRef = useRef<string | null>(null);
  // 请求代际：项目切换/快速重载时丢弃过期响应，避免旧请求覆盖新状态
  const listSeqRef = useRef(0);

  const refreshRooms = useCallback(async (projectId?: string | null) => {
    const seq = ++listSeqRef.current;
    setState((current) => ({ ...current, isLoading: true }));
    try {
      const query = projectId === undefined ? "" : `?projectId=${projectId === null ? "" : encodeURIComponent(projectId)}`;
      const response = await fetch(`/api/rooms${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "无法读取聊天室列表。"));
      const payload = (await response.json()) as { rooms?: Room[] };
      if (seq !== listSeqRef.current) return;
      setState({ rooms: payload.rooms ?? [], isLoading: false, error: "" });
    } catch (error) {
      if (seq !== listSeqRef.current) return;
      setState((current) => ({ ...current, isLoading: false, error: error instanceof Error ? error.message : "无法读取聊天室列表。" }));
    }
  }, []);

  const loadDetail = useCallback(async (roomId: string) => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "无法读取聊天室。"));
      const payload = (await response.json()) as RoomDetail;
      if (selectedRoomIdRef.current === roomId) setDetail(payload);
    } catch (error) {
      if (selectedRoomIdRef.current === roomId) {
        setState((current) => ({ ...current, error: error instanceof Error ? error.message : "无法读取聊天室。" }));
      }
    }
  }, []);

  const selectRoom = useCallback((roomId: string | null) => {
    selectedRoomIdRef.current = roomId;
    setDetail(null);
    if (roomId) void loadDetail(roomId);
  }, [loadDetail]);

  // 房间视图打开时轮询详情：角色响应完成会把回复写入房间消息。
  useEffect(() => {
    if (!detail?.room.id) return;
    const roomId = detail.room.id;
    const timer = window.setInterval(() => { void loadDetail(roomId); }, DETAIL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [detail?.room.id, loadDetail]);

  const createRoom = useCallback(async (input: CreateRoomInput): Promise<Room> => {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response, "创建聊天室失败。"));
    const payload = (await response.json()) as { room: Room };
    setState((current) => ({ ...current, rooms: [...current.rooms, payload.room] }));
    return payload.room;
  }, []);

  const deleteRoom = useCallback(async (roomId: string) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response, "删除聊天室失败。"));
    setState((current) => ({ ...current, rooms: current.rooms.filter((room) => room.id !== roomId) }));
    if (selectedRoomIdRef.current === roomId) {
      selectedRoomIdRef.current = null;
      setDetail(null);
    }
  }, []);

  const renameRoom = useCallback(async (roomId: string, name: string) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error(await readError(response, "重命名失败。"));
    const payload = (await response.json()) as { room: Room };
    setState((current) => ({ ...current, rooms: current.rooms.map((room) => (room.id === roomId ? payload.room : room)) }));
    setDetail((current) => (current && current.room.id === roomId ? { ...current, room: payload.room } : current));
  }, []);

  /** 发送消息：不传 targetParticipantId 为群聊（广播给所有角色），传则为私聊（只有该角色可见并响应）。 */
  const sendMessage = useCallback(async (roomId: string, content: string, targetParticipantId?: string) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetParticipantId ? { content, targetParticipantId } : { content }),
    });
    if (!response.ok) throw new Error(await readError(response, "发送消息失败。"));
    await loadDetail(roomId);
  }, [loadDetail]);

  /** 更换角色模型：只换底层模型，会话上下文保留。 */
  const updateParticipant = useCallback(async (roomId: string, participantId: string, patch: { role?: string; modelKey?: string }) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(await readError(response, "更新角色失败。"));
    const payload = (await response.json()) as { room: Room };
    setDetail((current) => (current && current.room.id === roomId ? { ...current, room: payload.room } : current));
    setState((current) => ({ ...current, rooms: current.rooms.map((room) => (room.id === roomId ? payload.room : room)) }));
  }, []);

  const addParticipant = useCallback(async (roomId: string, input: { role: string; modelKey: string }) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response, "添加角色失败。"));
    const payload = (await response.json()) as { room: Room };
    setDetail((current) => (current && current.room.id === roomId ? { ...current, room: payload.room } : current));
  }, []);

  const removeParticipant = useCallback(async (roomId: string, participantId: string) => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response, "移除角色失败。"));
    const payload = (await response.json()) as { room: Room };
    setDetail((current) => (current && current.room.id === roomId ? { ...current, room: payload.room } : current));
  }, []);

  return {
    rooms: state.rooms,
    isLoading: state.isLoading,
    error: state.error,
    detail,
    refreshRooms,
    selectRoom,
    loadDetail,
    createRoom,
    deleteRoom,
    renameRoom,
    sendMessage,
    updateParticipant,
    addParticipant,
    removeParticipant,
  };
}
