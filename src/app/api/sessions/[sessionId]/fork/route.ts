import { NextRequest, NextResponse } from "next/server";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { parseSessionForkRequest, SessionForkValidationError } from "@/server/session-fork";
import { tryLockSession } from "@/server/session-lock";
import { SessionEntryNotFoundError, SessionNotFoundError } from "@/server/sessions";
import { forkProjectPersistentSession, projectIdForSession } from "@/server/session-workspaces";
import { assignSessionToProject } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(
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

  let entryId: string | undefined;
  if (request.body) {
    const contentType = request.headers.get("content-type")?.toLowerCase();
    if (!contentType?.startsWith("application/json")) {
      return NextResponse.json(
        { error: { code: "invalid_session_entry", message: "Fork request bodies must be JSON." } },
        { status: 400, headers: NO_STORE },
      );
    }
    try {
      entryId = parseSessionForkRequest(await request.json());
    } catch (error) {
      const message = error instanceof SessionForkValidationError ? error.message : "Request body must be valid JSON.";
      return NextResponse.json({ error: { code: "invalid_session_entry", message } }, { status: 400, headers: NO_STORE });
    }
  }

  const lock = tryLockSession(sessionId);
  if (!lock) {
    return NextResponse.json(
      { error: { code: "session_busy", message: "The requested session is already running." } },
      { status: 409, headers: NO_STORE },
    );
  }

  try {
    const session = await forkProjectPersistentSession(sessionId, entryId);
    const projectId = await projectIdForSession(sessionId);
    if (projectId) await assignSessionToProject(session.id, projectId);
    return NextResponse.json({ session }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        { error: { code: "session_not_found", message: "The requested session does not exist." } },
        { status: 404, headers: NO_STORE },
      );
    }
    if (error instanceof SessionEntryNotFoundError) {
      return NextResponse.json(
        { error: { code: "session_entry_not_found", message: "The requested session entry is unavailable for forking." } },
        { status: 404, headers: NO_STORE },
      );
    }
    console.error("Unable to fork Pi session", error);
    return NextResponse.json(
      { error: { code: "session_unavailable", message: "Unable to copy the requested session." } },
      { status: 503, headers: NO_STORE },
    );
  } finally {
    lock.release();
  }
}
