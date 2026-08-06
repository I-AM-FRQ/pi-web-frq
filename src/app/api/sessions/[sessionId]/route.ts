import { NextRequest, NextResponse } from "next/server";
import type { SessionDetail } from "@/contracts";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { SESSION_ENTRY_ID_PATTERN } from "@/server/session-fork";
import { parseSessionNameRequest, SessionNameValidationError } from "@/server/session-name";
import { tryLockSession } from "@/server/session-lock";
import { projectSessionContext } from "@/server/session-context";
import { projectSessionConversation } from "@/server/session-projection";
import { projectSessionTree } from "@/server/session-tree";
import { projectSessionUsage } from "@/server/session-usage";
import { getAvailableModels } from "@/server/pi";
import { invalidateSessionIndex, SessionNotFoundError } from "@/server/sessions";
import { deleteProjectPersistentSession, getProjectSessionSummary, openProjectPersistentSession, openProjectPersistentSessionWithSummary } from "@/server/session-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function sessionIdFrom(context: { params: Promise<{ sessionId: string }> }) {
  return context.params.then(({ sessionId }) => {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("invalid_session_id");
    return sessionId;
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json(
      { error: { code: "invalid_session_id", message: "The session id is invalid." } },
      { status: 400, headers: NO_STORE },
    );
  }
  const previewEntryId = request.nextUrl.searchParams.get("entryId");
  const includeTree = request.nextUrl.searchParams.get("includeTree") === "true";
  const rawConversationOffset = request.nextUrl.searchParams.get("conversationOffset");
  const conversationOffset = rawConversationOffset === null ? 0 : Number(rawConversationOffset);
  if (!Number.isSafeInteger(conversationOffset) || conversationOffset < 0 || conversationOffset > 1_000_000) {
    return NextResponse.json(
      { error: { code: "invalid_conversation_offset", message: "conversationOffset must be a non-negative integer." } },
      { status: 400, headers: NO_STORE },
    );
  }
  if (previewEntryId !== null && !SESSION_ENTRY_ID_PATTERN.test(previewEntryId)) {
    return NextResponse.json(
      { error: { code: "invalid_session_entry", message: "entryId must be an 8-character session entry identifier." } },
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const { session, sessionManager } = await openProjectPersistentSessionWithSummary(sessionId);
    if (previewEntryId && !sessionManager.getEntry(previewEntryId)) {
      return NextResponse.json(
        { error: { code: "session_entry_not_found", message: "The requested session entry does not exist." } },
        { status: 404, headers: NO_STORE },
      );
    }
    const observedEntryId = previewEntryId ?? undefined;
    const conversation = projectSessionConversation(sessionManager, undefined, observedEntryId, conversationOffset);
    const tree = includeTree ? projectSessionTree(sessionManager) : { tree: [], truncated: false };
    const estimatedContext = projectSessionContext(sessionManager, null, observedEntryId);
    const availableModels = await getAvailableModels().catch(() => []);
    const contextWindow = estimatedContext.model
      ? availableModels.find((model) => model.provider === estimatedContext.model?.provider && model.id === estimatedContext.model?.id)?.contextWindow ?? null
      : null;
    const context = projectSessionContext(sessionManager, contextWindow, observedEntryId);
    const detail: SessionDetail = {
      session,
      activeLeafId: sessionManager.getLeafId(),
      previewEntryId,
      conversation: conversation.items,
      tree: tree.tree,
      usage: projectSessionUsage(sessionManager, observedEntryId),
      context,
      conversationNextOffset: conversation.nextOffset,
      truncated: { conversation: conversation.truncated, tree: tree.truncated },
      treeLoaded: includeTree,
    };
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        { error: { code: "session_not_found", message: "The requested session does not exist." } },
        { status: 404, headers: NO_STORE },
      );
    }
    console.error("Unable to open Pi session", error);
    return NextResponse.json(
      { error: { code: "session_unavailable", message: "Unable to open the requested session." } },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  let sessionId: string;
  try {
    sessionId = await sessionIdFrom(context);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_session_id", message: "The session id is invalid." } },
      { status: 400, headers: NO_STORE },
    );
  }

  const lock = tryLockSession(sessionId);
  if (!lock) {
    return NextResponse.json(
      { error: { code: "session_busy", message: "The requested session is already running." } },
      { status: 409, headers: NO_STORE },
    );
  }

  try {
    await deleteProjectPersistentSession(sessionId);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        { error: { code: "session_not_found", message: "The requested session does not exist." } },
        { status: 404, headers: NO_STORE },
      );
    }
    console.error("Unable to delete Pi session", error);
    return NextResponse.json(
      { error: { code: "session_unavailable", message: "Unable to delete the requested session." } },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    lock.release();
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  let sessionId: string;
  try {
    sessionId = await sessionIdFrom(context);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_session_id", message: "The session id is invalid." } },
      { status: 400, headers: NO_STORE },
    );
  }

  let name: string;
  try {
    name = parseSessionNameRequest(await request.json());
  } catch (error) {
    const message = error instanceof SessionNameValidationError ? error.message : "Request body must be valid JSON.";
    return NextResponse.json({ error: { code: "invalid_session_name", message } }, { status: 400, headers: NO_STORE });
  }

  const lock = tryLockSession(sessionId);
  if (!lock) {
    return NextResponse.json(
      { error: { code: "session_busy", message: "The requested session is already running." } },
      { status: 409, headers: NO_STORE },
    );
  }

  try {
    const sessionManager = await openProjectPersistentSession(sessionId);
    sessionManager.appendSessionInfo(name);
    invalidateSessionIndex(sessionManager.getCwd());
    return NextResponse.json({ session: await getProjectSessionSummary(sessionId) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        { error: { code: "session_not_found", message: "The requested session does not exist." } },
        { status: 404, headers: NO_STORE },
      );
    }
    console.error("Unable to rename Pi session", error);
    return NextResponse.json(
      { error: { code: "session_unavailable", message: "Unable to rename the requested session." } },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    lock.release();
  }
}
