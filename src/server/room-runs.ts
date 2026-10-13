import { createChatSession, getAvailableModels } from "@/server/pi";
import { createProjectPersistentSession, openProjectPersistentSession, workspaceForProject, workspaceForSession } from "@/server/session-workspaces";
import { hasActiveChatRun, publishActiveChatRunEvent, registerActiveChatRun, unregisterActiveChatRun } from "@/server/active-chat-runs";
import { invalidateSessionIndex } from "@/server/sessions";
import { appendRoomMessage, setParticipantSession, type Room, type RoomMessage, type RoomParticipant } from "@/server/rooms";
import { publishSessionEvent } from "@/server/session-events";

/**
 * 聊天室角色响应编排。
 *
 * 分两段执行：
 * 1. 启动段（被路由 await，保证一定执行）：准备该角色的独立持久会话（首次响应时创建，并记录 sessionId）
 *    → 用角色当前模型创建可运行会话 → 注册运行、订阅事件、广播 start。这一步很快。
 * 2. 完成段（后台继续）：等待模型输出结束 → 广播 done/error → 把回复写成房间消息 → 释放会话。
 *
 * 采用“请求内完成启动、后台等待输出”的原因：模型回答可能持续几十秒，
 * 既不能阻塞 HTTP 响应，也不能依赖响应发出后的异步调度（在 Next dev worker 下会被中断）。
 */

/** 注入给角色的房间上下文：只带最近若干条，控制 token 消耗。 */
const ROOM_CONTEXT_MESSAGES = 12;

function senderLabel(message: RoomMessage): string {
	if (message.sender.type === "user") return "用户";
	return message.sender.role || "角色";
}

/**
 * 构造注入文本：
 * - 群聊触发：带上房间最近公开消息，让各角色看到彼此进展（多模型互相纠偏的基础）
 * - 私聊触发：明确告知只有该角色可见
 */
export function buildRoomPrompt(input: {
	room: Room;
	participant: RoomParticipant;
	content: string;
	messages: RoomMessage[];
	visibility: "room" | "private";
}): string {
	const { room, participant, content, visibility } = input;
	const lines: string[] = [`[聊天室「${room.name}」] 你是房间中的角色「${participant.role}」。`];
	if (visibility === "private") {
		lines.push(
			"",
			"用户单独对你（只有你能看到这条消息，其他角色看不到）说：",
			content,
			"",
			`请以角色「${participant.role}」的身份回应这条私聊。`,
		);
		return lines.join("\n");
	}
	const context = input.messages
		.filter((message) => message.visibility === "room")
		.slice(-ROOM_CONTEXT_MESSAGES)
		.filter((message) => !(message.sender.type === "participant" && message.sender.participantId === participant.id && message.content === content));
	if (context.length > 0) {
		lines.push("", "房间最近的公开消息：");
		for (const message of context) {
			const text = message.content.replace(/\s+/g, " ").trim();
			lines.push(`[${senderLabel(message)}] ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`);
		}
	}
	lines.push("", "最新一条消息：", content, "");
	lines.push(`请以角色「${participant.role}」的身份继续协作：给出你的判断与成果，不要复述上面的上下文。`);
	return lines.join("\n");
}

export type StartParticipantReplyInput = {
	room: Room;
	participant: RoomParticipant;
	content: string;
	messages: RoomMessage[];
	visibility: "room" | "private";
};

export type StartParticipantReplyResult =
	| { ok: true; sessionId: string }
	| { ok: false; reason: "busy" | "model_unavailable" | "failed"; detail?: string };

/** 准备角色的持久会话：已存在则打开；未创建（或已失效）则新建，并把新 sessionId 记回房间。 */
async function ensureParticipantSession(room: Room, participant: RoomParticipant) {
	if (participant.sessionId) {
		try {
			const manager = await openProjectPersistentSession(participant.sessionId);
			return { manager, workspacePath: await workspaceForSession(participant.sessionId), sessionId: participant.sessionId };
		} catch {
			// 会话文件不存在（例如被清理）——回退到新建，避免角色永久不可用。
		}
	}
	const manager = await createProjectPersistentSession(room.projectId ?? undefined);
	const sessionId = manager.getSessionId();
	await setParticipantSession(room.id, participant.id, sessionId).catch((error) => {
		console.error("Unable to record room participant session", error);
	});
	return { manager, workspacePath: await workspaceForProject(room.projectId ?? undefined), sessionId };
}

export async function startParticipantReply(input: StartParticipantReplyInput): Promise<StartParticipantReplyResult> {
	const { room, participant, visibility } = input;
	// 同一角色不允许并发运行（避免上下文交叉与重复回复）。
	if (participant.sessionId && hasActiveChatRun(participant.sessionId)) return { ok: false, reason: "busy" };

	let sessionManager;
	let projectWorkspace: string;
	let sessionId: string;
	let model;
	try {
		const prepared = await ensureParticipantSession(room, participant);
		sessionManager = prepared.manager;
		projectWorkspace = prepared.workspacePath;
		sessionId = prepared.sessionId;
		// 角色模型可随时更换：以房间记录里的 modelKey 为准，而不是会话里保存的旧模型。
		const models = await getAvailableModels();
		model = models.find((candidate) => `${candidate.provider}:${candidate.id}` === participant.modelKey) ?? models[0];
	} catch (error) {
		console.error(`Room participant ${participant.role} session prepare failed`, error);
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	}
	if (!model) return { ok: false, reason: "model_unavailable" };
	if (hasActiveChatRun(sessionId)) return { ok: false, reason: "busy" };

	const promptText = buildRoomPrompt(input);
	let session;
	try {
		({ session } = await createChatSession(model, undefined, sessionManager, undefined, projectWorkspace));
	} catch (error) {
		console.error(`Room participant ${participant.role} session create failed`, error);
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	}

	const streamed = { assistantText: "", thinkingText: "" };
	const unsubscribe = session.subscribe((event) => publishSessionEvent(sessionId, event, streamed));
	registerActiveChatRun(sessionId, session);
	publishActiveChatRunEvent(sessionId, {
		type: "start",
		runId: session.sessionId,
		sessionId,
		prompt: promptText,
		model: { provider: model.provider, id: model.id },
	});

	// 后台等待输出完成：写回房间消息 + 广播终态 + 释放资源。
	void session.prompt(promptText).then(async () => {
		publishActiveChatRunEvent(sessionId, { type: "done", sessionId });
		const reply = streamed.assistantText.trim();
		if (reply) {
			await appendRoomMessage({
				roomId: room.id,
				sender: { type: "participant", participantId: participant.id, role: participant.role },
				content: reply,
				// 私聊的回复也只在该角色的私聊视图可见。
				visibility,
				...(visibility === "private" ? { targetParticipantId: participant.id } : {}),
			}).catch((error) => console.error("Unable to append room reply", error));
		}
	}).catch((error: unknown) => {
		console.error(`Room participant ${participant.role} prompt failed`, error);
		publishActiveChatRunEvent(sessionId, {
			type: "error",
			code: "chat_failed",
			message: error instanceof Error ? error.message : "角色响应失败。",
		});
	}).finally(() => {
		unsubscribe();
		unregisterActiveChatRun(sessionId, session);
		try { session.dispose(); } catch (error) { console.error("Unable to dispose room session", error); }
		invalidateSessionIndex(projectWorkspace);
	});

	return { ok: true, sessionId };
}
