import { askDecisionModel } from "@/server/decision";
import type { Room, RoomMessage } from "@/server/rooms";

/**
 * 聊天室消息路由：决定一条用户消息该由哪些角色响应。
 *
 * 优先级：
 * 1. @指定（mention）——消息里出现 @角色名，只触发被点名的角色（可靠、零成本）
 * 2. 群发关键词（broadcast）——出现「大家 / 所有人 / 各位 / 都」等词时触发全部角色
 * 3. 辨认（routing）——由决策模型根据角色职责与最近对话判断该谁回应
 * 4. 未匹配（none）——不触发任何角色，仅在房间留痕（前端提示用 @ 指定）
 */

export type RoomRoutingReason = "mention" | "broadcast" | "routing" | "none";

export type RoomRouting = {
  /** 要响应的角色 id 列表 */
  targets: string[];
  reason: RoomRoutingReason;
  /** 面向用户的说明（例如辨认依据、或未匹配时的提示） */
  detail?: string;
};

const BROADCAST_PATTERN = /(大家|所有人|各位|全体|你们俩|都看下|都说说|一起看)/;

/** 解析 @角色名：支持中文角色名，命中返回角色 id（按出现顺序去重）。 */
export function parseMentions(content: string, room: Room): string[] {
  const hits: string[] = [];
  for (const participant of room.participants) {
    const role = participant.role;
    if (!role) continue;
    // @角色名（后面允许跟空格/标点/汉字边界）；也兼容全角＠
    const pattern = new RegExp(`[@＠]${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w\\u4e00-\\u9fa5])`);
    if (pattern.test(content) && !hits.includes(participant.id)) hits.push(participant.id);
  }
  return hits;
}

/** 让决策模型判断该由谁回应；返回角色名列表（空数组表示无人需要回应）。 */
async function routingByDecisionModel(input: {
  room: Room;
  content: string;
  messages: RoomMessage[];
}): Promise<{ names: string[]; detail?: string } | null> {
  const { room, content, messages } = input;
  const roster = room.participants
    .map((participant) => `- ${participant.role}：${(participant.rolePrompt ?? "").replace(/\s+/g, " ").slice(0, 120) || "（无额外说明）"}`)
    .join("\n");
  const recent = messages
    .slice(-6)
    .map((message) => `[${message.sender.type === "user" ? "用户" : message.sender.role}] ${message.content.replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");

  const result = await askDecisionModel({
    kind: "decision",
    question: [
      "下面是聊天室的角色名单。请判断用户这条新消息应该由哪些角色回应。",
      "",
      "角色名单：",
      roster,
      "",
      "最近的对话：",
      recent || "（暂无）",
      "",
      "用户的新消息：",
      content,
      "",
      "只输出需要回应的角色名（多个用逗号分隔，第一行只写角色名，不要写理由）。",
      "如果这是闲聊或没有角色需要介入，第一行只输出 NONE。理由（如有）请写在第二行之后。",
    ].join("\n"),
  });
  if (!result.ok) return null;
  const raw = result.decision.trim();
  if (/^none\b/i.test(raw) || raw === "NONE" || raw.startsWith("无需")) return { names: [], detail: "决策模型判断无需角色介入" };
  // 只解析首行（模型往往会在后面附上理由，若全量匹配会把理由里提到的角色也误判为响应者）。
  const firstLine = raw.split("\n")[0].trim();
  const names = room.participants
    .map((participant) => participant.role)
    .filter((role) => {
      const index = firstLine.indexOf(role);
      if (index === -1) return false;
      // 前面必须是分隔符或行首，避免子串误匹配（如「开发者」匹配到「前端开发者」）
      const before = firstLine[index - 1] ?? "";
      return before === "" || /[\s,，、;；/|：:]/.test(before);
    });
  return { names, detail: `决策模型判断：${firstLine.slice(0, 120)}` };
}

export async function routeRoomMessage(input: { room: Room; content: string; messages: RoomMessage[] }): Promise<RoomRouting> {
  const { room, content, messages } = input;

  // 1) @指定优先
  const mentioned = parseMentions(content, room);
  if (mentioned.length > 0) {
    const names = room.participants.filter((participant) => mentioned.includes(participant.id)).map((participant) => participant.role);
    return { targets: mentioned, reason: "mention", detail: `已点名：${names.join("、")}` };
  }

  // 2) 群发关键词
  if (BROADCAST_PATTERN.test(content)) {
    return { targets: room.participants.map((participant) => participant.id), reason: "broadcast", detail: "识别为群发消息" };
  }

  // 3) 决策模型辨认
  try {
    const routed = await routingByDecisionModel({ room, content, messages });
    if (routed) {
      const targets = room.participants.filter((participant) => routed.names.includes(participant.role)).map((participant) => participant.id);
      if (targets.length > 0) return { targets, reason: "routing", detail: routed.detail };
      return { targets: [], reason: "none", detail: routed.detail ?? "没有角色需要介入" };
    }
  } catch (error) {
    console.error("Room message routing failed", error);
  }

  // 4) 未配置决策模型或辨认失败：不触发，提示用 @ 指定
  return { targets: [], reason: "none", detail: "未匹配到角色：可用 @角色名 指定，或直接说“大家”触发全部角色" };
}
