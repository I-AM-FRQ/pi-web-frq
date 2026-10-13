import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatStreamEvent } from "@/contracts";
import { publishActiveChatRunEvent } from "@/server/active-chat-runs";
import { sanitizeSubagentDetails, toolResultText, toolStepLabel } from "@/server/session-projection";
import { userMessageStreamEvent } from "@/server/chat-user-message";

/**
 * 把 Pi AgentSession 事件转成 ChatStreamEvent 并广播给该会话的订阅者。
 *
 * chat 路由（普通会话）、wake 路由（后台唤醒）、聊天室角色响应共用同一套转换，
 * 保证不同入口的流式前端表现一致（thinking 增量、工具行、重试、user_message 等）。
 */
export function publishSessionEvent(sessionId: string, event: AgentSessionEvent, streamed: { assistantText: string; thinkingText: string }): void {
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
	if (event.type === "auto_retry_start") {
		publishActiveChatRunEvent(sessionId, { type: "retry_scheduled", attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: event.errorMessage });
	}
	if (event.type === "auto_retry_end") {
		publishActiveChatRunEvent(sessionId, { type: "retry_finished", success: event.success, attempt: event.attempt, message: event.finalError });
	}
	if (event.type === "queue_update") {
		publishActiveChatRunEvent(sessionId, { type: "queue_update", steering: event.steering, followUp: event.followUp });
	}
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
		// 工具调用轮不产出可见文本。
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

export function assistantVisibleText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type?: unknown; text?: unknown } => typeof part === "object" && part !== null)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("");
}

export function assistantThinkingText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type?: unknown; thinking?: unknown } => typeof part === "object" && part !== null)
		.filter((part) => part.type === "thinking" && typeof part.thinking === "string")
		.map((part) => part.thinking as string)
		.join("");
}

export type { ChatStreamEvent };
