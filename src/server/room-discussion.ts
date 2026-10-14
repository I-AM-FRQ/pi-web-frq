/**
 * 聊天室讨论轮次管理：让多个角色能就同一话题自动多轮讨论，而不是一轮就停。
 *
 * 规则：
 * - 用户发言开启一轮讨论（第 1 轮，触发目标角色）
 * - 本轮全部角色回复完成后，若未达上限且没有角色表示结束 → 自动进入下一轮（全体参与）
 * - 终止条件：达到最大轮次 / 有角色回复 [DONE] / 所有角色都回 [SKIP] / 用户发新消息或停止
 */

export type DiscussionState = {
  roomId: string;
  /** 当前轮次（从 1 开始） */
  round: number;
  maxRounds: number;
  /** 本轮仍在回复中的角色 id */
  pending: Set<string>;
  /** 本轮是否已有人表示结束（[DONE]） */
  concluded: boolean;
  /** 本轮是否全员跳过（[SKIP]） */
  allSkipped: boolean;
  updatedAt: number;
};

const DISCUSSIONS = new Map<string, DiscussionState>();
const STALE_MS = 30 * 60_000;

export const DEFAULT_MAX_ROUNDS = 3;

function pruneStale(now = Date.now()): void {
  for (const [roomId, state] of DISCUSSIONS) {
    if (now - state.updatedAt > STALE_MS) DISCUSSIONS.delete(roomId);
  }
}

/** 用户发言：开始（或重启）该房间的讨论。 */
export function startDiscussion(roomId: string, participantIds: string[], maxRounds = DEFAULT_MAX_ROUNDS): DiscussionState {
  pruneStale();
  const state: DiscussionState = {
    roomId,
    round: 1,
    maxRounds: Math.max(1, Math.min(maxRounds, 10)),
    pending: new Set(participantIds),
    concluded: false,
    allSkipped: true,
    updatedAt: Date.now(),
  };
  DISCUSSIONS.set(roomId, state);
  return state;
}

/** 结束该房间的讨论（用户停止、发新消息、或达到终止条件）。 */
export function endDiscussion(roomId: string): void {
  DISCUSSIONS.delete(roomId);
}

export function getDiscussion(roomId: string): DiscussionState | undefined {
  pruneStale();
  return DISCUSSIONS.get(roomId);
}

export type ReplyOutcome = {
  /** 该角色本轮表现：正常发言 / 跳过 / 表示结束 */
  kind: "reply" | "skip" | "done";
};

/**
 * 记录一次角色回复，并判断讨论是否进入下一轮。
 * 返回 nextRound > 0 表示需要继续（调用方应触发该轮角色）。
 */
export function recordDiscussionReply(roomId: string, participantId: string, outcome: ReplyOutcome): { nextRound: number } | { finished: true; reason: string } {
  const state = DISCUSSIONS.get(roomId);
  if (!state) return { finished: true, reason: "discussion_not_active" };
  state.pending.delete(participantId);
  state.updatedAt = Date.now();
  if (outcome.kind === "done") state.concluded = true;
  if (outcome.kind !== "skip") state.allSkipped = false;
  if (state.pending.size > 0) return { finished: true, reason: "waiting_others" };

  // 本轮已全部完成：判断是否继续
  if (state.concluded) {
    DISCUSSIONS.delete(roomId);
    return { finished: true, reason: "concluded" };
  }
  if (state.allSkipped) {
    DISCUSSIONS.delete(roomId);
    return { finished: true, reason: "all_skipped" };
  }
  if (state.round >= state.maxRounds) {
    DISCUSSIONS.delete(roomId);
    return { finished: true, reason: "max_rounds" };
  }
  state.round += 1;
  return { nextRound: state.round };
}

/** 进入下一轮前重设本轮待回复角色。 */
export function beginNextRound(roomId: string, participantIds: string[]): DiscussionState | undefined {
  const state = DISCUSSIONS.get(roomId);
  if (!state) return undefined;
  state.pending = new Set(participantIds);
  state.concluded = false;
  state.allSkipped = true;
  state.updatedAt = Date.now();
  return state;
}
