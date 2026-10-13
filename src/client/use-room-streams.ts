"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatStreamEvent, RoomParticipant } from "@/contracts";
import { readChatStreamEvents } from "@/client/use-chat-stream";

export type RoomStreamState = {
  /** 实时累积的回复文本（打字机效果） */
  text: string;
  /** 实时累积的思考文本 */
  thinking: string;
  /** 是否仍在输出 */
  isStreaming: boolean;
};

const EMPTY: RoomStreamState = { text: "", thinking: "", isStreaming: false };

/**
 * 订阅聊天室中正在运行的角色的实时输出。
 *
 * 每个角色本质上就是一个普通 pi 会话，因此直接复用 `/api/chat/[sessionId]/stream`
 * 的流式重放：角色开始响应（runningParticipantIds 出现）时接入，拿到 text_delta/thinking_delta
 * 逐字累积，从而在群聊里呈现与默认会话一致的打字机效果。
 */
export function useRoomStreams(participants: RoomParticipant[], runningParticipantIds: string[]): Record<string, RoomStreamState> {
  const [streams, setStreams] = useState<Record<string, RoomStreamState>>({});
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const runningKey = runningParticipantIds.join(",");

  useEffect(() => {
    const active = new Set(runningParticipantIds);
    // 结束运行的角色：停止订阅（正式回复随后由房间消息轮询呈现）
    for (const [participantId, controller] of controllersRef.current) {
      if (active.has(participantId)) continue;
      controller.abort();
      controllersRef.current.delete(participantId);
    }
    // 新开始运行的角色：接入其会话流
    for (const participant of participants) {
      if (!active.has(participant.id) || !participant.sessionId) continue;
      if (controllersRef.current.has(participant.id)) continue;
      const controller = new AbortController();
      controllersRef.current.set(participant.id, controller);
      setStreams((current) => ({ ...current, [participant.id]: { text: "", thinking: "", isStreaming: true } }));
      void (async () => {
        try {
          const response = await fetch(`/api/chat/${encodeURIComponent(participant.sessionId)}/stream`, { cache: "no-store", signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
          setStreams((current) => ({ ...current, [participant.id]: { ...(current[participant.id] ?? EMPTY), isStreaming: true } }));
          await readChatStreamEvents(response.body, (event: ChatStreamEvent) => {
            if (event.type === "text_delta") {
              setStreams((current) => {
                const previous = current[participant.id] ?? EMPTY;
                return { ...current, [participant.id]: { ...previous, text: previous.text + event.delta, isStreaming: true } };
              });
            }
            if (event.type === "thinking_delta") {
              setStreams((current) => {
                const previous = current[participant.id] ?? EMPTY;
                return { ...current, [participant.id]: { ...previous, thinking: previous.thinking + event.delta, isStreaming: true } };
              });
            }
            if (event.type === "user_message") {
              // 新一轮消息：清空上一轮的累积文本
              setStreams((current) => ({ ...current, [participant.id]: { text: "", thinking: "", isStreaming: true } }));
            }
            if (event.type === "done" || event.type === "error") {
              setStreams((current) => ({ ...current, [participant.id]: { ...(current[participant.id] ?? EMPTY), isStreaming: false } }));
            }
          });
        } catch {
          // 订阅失败时保持无实时文本，正式回复仍会由房间消息轮询呈现
        } finally {
          controllersRef.current.delete(participant.id);
        }
      })();
    }
  }, [participants, runningKey, runningParticipantIds]);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  return streams;
}
