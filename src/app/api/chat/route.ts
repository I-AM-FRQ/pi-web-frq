import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import type { ChatStreamEvent, ThinkingLevel } from "@/contracts";
import { ChatRequestValidationError, parseChatRequest } from "@/server/chat-request";
import { createChatSession, getAvailableModels, thinkingLevelsFor, type AvailableModel } from "@/server/pi";
import { tryLockSession } from "@/server/session-lock";
import { activeChatRunStopRequested, publishActiveChatRunEvent, registerActiveChatRun, subscribeToActiveChatRun, unregisterActiveChatRun } from "@/server/active-chat-runs";
import { assignSessionToProject } from "@/server/projects";
import { branchPersistentSession, invalidateSessionIndex, SessionEntryNotFoundError, SessionNotFoundError } from "@/server/sessions";
import { createProjectPersistentSession, openProjectPersistentSession, projectIdForSession, workspaceForProject, workspaceForSession } from "@/server/session-workspaces";
import { expandWorkspaceReferences } from "@/server/file-references";
import { toolResultText, toolStepLabel } from "@/server/session-projection";
import { AttachmentValidationError, storeImageAttachments } from "@/server/attachments";
import { SSE_HEADERS, sseEvent } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHAT_REQUEST_BYTES = 28 * 1024 * 1024;

// 提取 assistant 消息中可显示的文本（排除 thinking/工具调用等内部部分）。
function assistantVisibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

/**
 * 中断（abort）时 Pi 不会为未完成的消息触发 message_end，因此不会写入会话文件。
 * 这里把 agent 内部状态中尚未持久化的 assistant 消息补写进会话，保证停止后刷新仍能看到本次执行过程。
 */
function persistInterruptedAssistantMessages(sessionManager: SessionManager, agentMessages: AgentMessage[]) {
  const persistedKeys = new Set(
    sessionManager.getBranch()
      .filter((entry): entry is Extract<typeof entry, { type: "message" }> => entry.type === "message" && entry.message.role === "assistant")
      .map((entry) => JSON.stringify(entry.message)),
  );
  for (const message of agentMessages) {
    if (message.role !== "assistant") continue;
    const key = JSON.stringify(message);
    if (persistedKeys.has(key)) continue;
    const text = assistantVisibleText(message.content);
    const thinking = assistantThinkingText(message.content);
    if (text.trim().length === 0 && thinking.trim().length === 0) continue;
    sessionManager.appendMessage(message);
  }
}

// 提取 assistant 消息中的思考过程文本。
function assistantThinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; thinking?: unknown } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "thinking" && typeof part.thinking === "string")
    .map((part) => part.thinking as string)
    .join("");
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new Error("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_CHAT_REQUEST_BYTES) throw new RangeError("Request body is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(data)) as unknown;
}

function isThinkingLevel(value: string | undefined): value is ThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

function resolveModel(
  available: AvailableModel[],
  requested: { provider: string; id: string } | undefined,
  sessionManager: SessionManager,
): AvailableModel | undefined {
  if (requested) {
    return available.find((candidate) => candidate.provider === requested.provider && candidate.id === requested.id);
  }
  const contextModel = sessionManager.buildSessionContext().model;
  return contextModel
    ? available.find((candidate) => candidate.provider === contextModel.provider && candidate.id === contextModel.modelId) ?? available[0]
    : available[0];
}

const createPersistentChatSession = createChatSession as (
  model: AvailableModel,
  thinkingLevel: ThinkingLevel | undefined,
  sessionManager: SessionManager,
  resources?: { skills?: string[]; plugins?: string[] },
  root?: string,
) => ReturnType<typeof createChatSession>; 

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_CHAT_REQUEST_BYTES) {
    return errorResponse("request_too_large", "Request body is too large.", 413);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RangeError) return errorResponse("request_too_large", "Request body is too large.", 413);
    return errorResponse("invalid_request", "Request body must be valid JSON.", 400);
  }

  let chatRequest;
  try {
    chatRequest = parseChatRequest(body);
  } catch (error) {
    const message = error instanceof ChatRequestValidationError ? error.message : "Request body is invalid.";
    return errorResponse("invalid_request", message, 400);
  }

  let sessionManager: SessionManager;
  let projectWorkspace: string;
  try {
    if (chatRequest.sessionId) {
      const assignedProjectId = await projectIdForSession(chatRequest.sessionId);
      if (chatRequest.projectId !== undefined && chatRequest.projectId !== assignedProjectId) return errorResponse("project_mismatch", "The selected project does not match this session's isolated workspace.", 409);
      sessionManager = await openProjectPersistentSession(chatRequest.sessionId);
      projectWorkspace = await workspaceForSession(chatRequest.sessionId);
    } else {
      sessionManager = await createProjectPersistentSession(chatRequest.projectId);
      projectWorkspace = await workspaceForProject(chatRequest.projectId);
    }
  } catch (error) {
    if (error instanceof SessionNotFoundError) return errorResponse("session_not_found", "The requested session does not exist.", 404);
    console.error("Unable to open Pi session", error);
    return errorResponse("session_unavailable", "Unable to open a chat session.", 503);
  }

  const sessionId = sessionManager.getSessionId();
  if (!chatRequest.sessionId && chatRequest.projectId) {
    try {
      await assignSessionToProject(sessionId, chatRequest.projectId);
    } catch (error) {
      console.error("Unable to assign Pi session to project", error);
      return errorResponse("project_unavailable", "Unable to assign the chat session to the requested project.", 400);
    }
  }
  const lock = tryLockSession(sessionId);
  if (!lock) return errorResponse("session_busy", "The requested session is already running.", 409);

  let model: AvailableModel | undefined;
  let thinkingLevel: ThinkingLevel | undefined;
  try {
    const available = await getAvailableModels();
    model = resolveModel(available, chatRequest.model, sessionManager);
    if (!model) {
      lock.release();
      return errorResponse("model_unavailable", "The requested model is not available.", 400);
    }

    const contextThinking = sessionManager.buildSessionContext().thinkingLevel;
    thinkingLevel = chatRequest.thinkingLevel ?? (isThinkingLevel(contextThinking) ? contextThinking : undefined);
    if (thinkingLevel && !thinkingLevelsFor(model).includes(thinkingLevel)) {
      lock.release();
      return errorResponse("invalid_thinking_level", "The requested thinking level is unavailable for this model.", 400);
    }
  } catch (error) {
    lock.release();
    console.error("Unable to resolve Pi model", error);
    return errorResponse("models_unavailable", "Unable to resolve an available model.", 503);
  }

  try {
    if (chatRequest.branchFromEntryId) branchPersistentSession(sessionManager, chatRequest.branchFromEntryId);
  } catch (error) {
    lock.release();
    if (error instanceof SessionEntryNotFoundError) {
      return errorResponse("session_entry_not_found", "The requested session entry is unavailable for branching.", 404);
    }
    console.error("Unable to branch Pi session", error);
    return errorResponse("session_unavailable", "Unable to prepare the requested chat session.", 503);
  }

  let created;
  try {
    // 用已解析的 projectWorkspace（已有会话 = 会话所属项目 workspace；新会话 = 项目 workspace），
    // 不能再用 workspaceForProject(chatRequest.projectId)：老会话继续时前端不传 projectId，
    // 会回退到默认工作区，导致模型 cwd / workspace 工具 / 项目提示词全部指向错误目录。
    created = await createPersistentChatSession(model, thinkingLevel, sessionManager, chatRequest.resources, projectWorkspace);
  } catch (error) {
    lock.release();
    console.error("Unable to create Pi chat session", error);
    return errorResponse("session_unavailable", "Unable to create a chat session.", 503);
  }

  const { session } = created;
  session.setAutoRetryEnabled(chatRequest.autoRetry ?? true);
  let imageUrls: string[] = [];
  try {
    if (chatRequest.images?.length) {
      imageUrls = (await storeImageAttachments(sessionId, chatRequest.images, join(projectWorkspace, ".pi-web-attachments"))).map((attachment) => attachment.url);
    }
  } catch (error) {
    session.dispose();
    lock.release();
    const message = error instanceof AttachmentValidationError ? error.message : "Unable to store image attachments.";
    return errorResponse("invalid_images", message, 400);
  }

  let detachSubscriber: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let subscriberDetached = false;
      let finished = false;
      let unsubscribeSession: () => void = () => {};
      const runSubscription: { current?: () => void } = {};
      const heartbeatRef: { current?: ReturnType<typeof setInterval> } = {}; 
      const emit = (event: ChatStreamEvent) => {
        if (subscriberDetached) return;
        try {
          controller.enqueue(sseEvent(event));
        } catch {
          subscriberDetached = true;
        }
      };
      const detach = () => {
        if (subscriberDetached) return;
        subscriberDetached = true;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        runSubscription.current?.();
        try { controller.close(); } catch { /* reader may already have cancelled */ }
      };
      const finish = (event: Extract<ChatStreamEvent, { type: "done" | "error" }>) => {
        if (finished) return;
        finished = true;
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        unsubscribeSession();
        if (event.type === "error") {
          // 中断/失败时补写尚未落盘的部分 assistant 内容，刷新后仍可见。
          try {
            persistInterruptedAssistantMessages(sessionManager, session.messages);
          } catch (error) {
            console.error("Unable to persist interrupted assistant messages", error);
          }
        }
        try {
          session.dispose();
        } catch (error) {
          console.error("Unable to persist Pi session", error);
        }
        invalidateSessionIndex(projectWorkspace);
        lock.release();
        publishActiveChatRunEvent(sessionId, event);
        unregisterActiveChatRun(sessionId, session);
        try { controller.close(); } catch { /* reader may already have cancelled */ }
      };
      // 将 Pi 的流式事件转发为 SSE 增量文本，实现打字机效果。
      let streamedAssistantText = "";
      let streamedThinkingText = "";
      const visiblePrompt = imageUrls.length
        ? `${imageUrls.map((url, index) => `![上传图片 ${index + 1}](${url})`).join("\n\n")}\n\n${chatRequest.prompt}`
        : chatRequest.prompt;
      try {
        unsubscribeSession = session.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          publishActiveChatRunEvent(sessionId, { type: "tool_start", id: event.toolCallId, name: event.toolName, label: toolStepLabel(event.toolName, event.args) });
        }
        if (event.type === "tool_execution_end") {
          publishActiveChatRunEvent(sessionId, { type: "tool_end", id: event.toolCallId, result: toolResultText(event.result), isError: event.isError });
        }
        if (event.type === "auto_retry_start") {
          publishActiveChatRunEvent(sessionId, {
            type: "retry_scheduled",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            message: event.errorMessage,
          });
        }
        if (event.type === "auto_retry_end") {
          publishActiveChatRunEvent(sessionId, {
            type: "retry_finished",
            success: event.success,
            attempt: event.attempt,
            message: event.finalError,
          });
        }
        if (event.type === "queue_update") {
          publishActiveChatRunEvent(sessionId, { type: "queue_update", steering: event.steering, followUp: event.followUp });
        }
        if (event.type === "message_start") {
          streamedAssistantText = "";
          streamedThinkingText = "";
        }
        if (event.type === "message_update") {
          const message = event.message;
          if (message.role !== "assistant") return;
          const thinking = assistantThinkingText(message.content);
          if (thinking.length > streamedThinkingText.length) {
            publishActiveChatRunEvent(sessionId, { type: "thinking_delta", delta: thinking.slice(streamedThinkingText.length) });
            streamedThinkingText = thinking;
          }
          // 工具调用轮不产出可见文本。
          if (Array.isArray(message.content) && message.content.some((part) => (part as { type?: string }).type === "tool_call")) {
            streamedAssistantText = "";
            return;
          }
          const text = assistantVisibleText(message.content);
          if (text.length > streamedAssistantText.length) {
            publishActiveChatRunEvent(sessionId, { type: "text_delta", delta: text.slice(streamedAssistantText.length) });
            streamedAssistantText = text;
          }
        }
      });
      heartbeatRef.current = setInterval(() => {
        if (subscriberDetached || finished) return;
        try {
          controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
        } catch {
          detach();
        }
      }, 20_000);

      registerActiveChatRun(sessionId, session);
      runSubscription.current = subscribeToActiveChatRun(sessionId, emit);
      publishActiveChatRunEvent(sessionId, { type: "start", runId: session.sessionId, sessionId, prompt: visiblePrompt, model: { provider: model.provider, id: model.id } });
      detachSubscriber = detach;
      request.signal.addEventListener("abort", detach, { once: true });
      if (request.signal.aborted) {
        detach();
        return;
      }
      } catch (error) {
        // 启动阶段同步错误：释放锁并结束流，避免该会话被永久锁死（无法再发送）。
        console.error("Unable to start Pi chat stream", error);
        try { unsubscribeSession(); } catch { /* ignore */ }
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        try { session.dispose(); } catch { /* ignore */ }
        invalidateSessionIndex(projectWorkspace);
        lock.release();
        try { unregisterActiveChatRun(sessionId, session); } catch { /* ignore */ }
        try { controller.error(error); } catch { /* reader may already have cancelled */ }
        return;
      }
      // 只检查本次 prompt 新增的消息。历史会话里的旧失败不能污染后续正常运行。
      const messageCountBeforePrompt = session.messages.length;
      void expandWorkspaceReferences(visiblePrompt, (path) => import("@/server/workspace-files").then(({ previewWorkspaceFile }) => previewWorkspaceFile(path, projectWorkspace))).then((expandedPrompt) => session.prompt(expandedPrompt, { images: chatRequest.images })).then(() => {
        if (activeChatRunStopRequested(sessionId)) {
          finish({ type: "error", code: "chat_stopped", message: "已停止。" });
          return;
        }
        const failureMessage = [...session.messages.slice(messageCountBeforePrompt)].reverse()
          .map((message) => message.role === "assistant" && "errorMessage" in message && typeof message.errorMessage === "string" ? message.errorMessage : "")
          .find((message) => message.length > 0);
        finish(failureMessage
          ? { type: "error", code: "chat_failed", message: failureMessage }
          : { type: "done", sessionId });
      }).catch((error: unknown) => {
        const stopped = activeChatRunStopRequested(sessionId);
        if (!request.signal.aborted && !stopped) console.error("Pi chat prompt failed", error);
        finish(stopped
          ? { type: "error", code: "chat_stopped", message: "已停止。" }
          : { type: "error", code: "chat_failed", message: "The chat run failed." });
      });
    },
    cancel() {
      detachSubscriber?.();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
