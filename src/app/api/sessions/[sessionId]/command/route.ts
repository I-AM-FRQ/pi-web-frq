import { NextRequest, NextResponse } from "next/server";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { createChatSession, getAvailableModels, type AvailableModel } from "@/server/pi";
import { SessionCommandValidationError, parseSessionCommandRequest } from "@/server/session-command";
import { tryLockSession } from "@/server/session-lock";
import { invalidateSessionIndex, SessionNotFoundError } from "@/server/sessions";
import { getProjectSessionSummary, openProjectPersistentSession, workspaceForSession } from "@/server/session-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

function resolveSessionModel(available: AvailableModel[], sessionManager: SessionManager): AvailableModel | undefined {
  const contextModel = sessionManager.buildSessionContext().model;
  if (!contextModel) return available[0];
  return available.find((model) => model.provider === contextModel.provider && model.id === contextModel.modelId) ?? available[0];
}

function isThinkingLevel(value: string): value is "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value);
}

function formatStats(stats: {
  sessionId: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  tokens: { total: number };
  cost: number;
}) {
  return [
    `Session: ${stats.sessionId}`,
    `Messages: ${stats.totalMessages} (${stats.userMessages} user, ${stats.assistantMessages} assistant)`,
    `Tools: ${stats.toolCalls} calls, ${stats.toolResults} results`,
    `Tokens: ${stats.tokens.total}`,
    `Cost: $${stats.cost.toFixed(4)}`,
  ].join("\n");
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) return errorResponse("invalid_session_id", "The session id is invalid.", 400);

  let commandRequest;
  try {
    commandRequest = parseSessionCommandRequest(await request.json());
  } catch (error) {
    const message = error instanceof SessionCommandValidationError ? error.message : "Request body must be valid JSON.";
    return errorResponse("invalid_command", message, 400);
  }

  const lock = tryLockSession(sessionId);
  if (!lock) return errorResponse("session_busy", "The requested session is already running.", 409);

  let session: Awaited<ReturnType<typeof createChatSession>>["session"] | undefined;
  let sessionManager: SessionManager | undefined;
  let root: string | undefined;
  try {
    sessionManager = await openProjectPersistentSession(sessionId);
    root = await workspaceForSession(sessionId);

    if (commandRequest.command === "name") {
      sessionManager.appendSessionInfo(commandRequest.argument);
      invalidateSessionIndex(root);
      return NextResponse.json({ command: "name", message: "会话名称已更新。", session: await getProjectSessionSummary(sessionId) }, { headers: NO_STORE });
    }

    const model = resolveSessionModel(await getAvailableModels(), sessionManager);
    if (!model) return errorResponse("model_unavailable", "No available model can run this command.", 400);
    const savedThinkingLevel = sessionManager.buildSessionContext().thinkingLevel;
    const created = await createChatSession(model, isThinkingLevel(savedThinkingLevel) ? savedThinkingLevel : undefined, sessionManager, undefined, root);
    session = created.session;

    if (commandRequest.command === "compact") {
      const result = await session.compact(commandRequest.argument || undefined);
      invalidateSessionIndex(root);
      return NextResponse.json({ command: "compact", message: "上下文已压缩。", estimatedTokensAfter: result.estimatedTokensAfter }, { headers: NO_STORE });
    }
    if (commandRequest.command === "reload") {
      await session.reload();
      return NextResponse.json({ command: "reload", message: "扩展、技能、提示词和工具已重新加载。" }, { headers: NO_STORE });
    }
    if (commandRequest.command === "copy") {
      const text = session.getLastAssistantText();
      if (!text) return errorResponse("nothing_to_copy", "There is no assistant response to copy.", 400);
      return NextResponse.json({ command: "copy", text }, { headers: NO_STORE });
    }
    return NextResponse.json({ command: "session", text: formatStats(session.getSessionStats()) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionNotFoundError) return errorResponse("session_not_found", "The requested session does not exist.", 404);
    console.error("Unable to execute session command", error);
    return errorResponse("command_failed", error instanceof Error ? error.message : "Unable to execute this command.", 500);
  } finally {
    try {
      session?.dispose();
    } catch {
      // A command result is already persisted by the session manager when applicable.
    }
    lock.release();
  }
}
