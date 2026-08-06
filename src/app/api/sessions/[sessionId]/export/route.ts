import { NextRequest, NextResponse } from "next/server";
import { SESSION_ID_PATTERN } from "@/server/chat-request";
import { parseSessionExportRequest, SessionExportTooLargeError, SessionExportUnsafeContentError, SessionExportValidationError, projectSessionExport } from "@/server/session-export";
import { tryLockSession } from "@/server/session-lock";
import { SessionNotFoundError } from "@/server/sessions";
import { openProjectPersistentSession } from "@/server/session-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Content-Type": "text/plain; charset=utf-8",
  "Content-Disposition": "attachment; filename=pi-web-frq-session.txt",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId)) return errorResponse("invalid_session_id", "The session id is invalid.", 400);

  let entryId: string | undefined;
  try {
    entryId = parseSessionExportRequest(await request.json());
  } catch (error) {
    const message = error instanceof SessionExportValidationError ? error.message : "Request body must be valid JSON.";
    return errorResponse("invalid_session_export", message, 400);
  }

  const lock = tryLockSession(sessionId);
  if (!lock) return errorResponse("session_busy", "The requested session is already running.", 409);

  try {
    const session = await openProjectPersistentSession(sessionId);
    if (entryId && !session.getEntry(entryId)) return errorResponse("session_entry_not_found", "The requested session entry does not exist.", 404);
    return new NextResponse(projectSessionExport(session, entryId), { headers: HEADERS });
  } catch (error) {
    if (error instanceof SessionNotFoundError) return errorResponse("session_not_found", "The requested session does not exist.", 404);
    if (error instanceof SessionExportTooLargeError) return errorResponse("session_export_too_large", "The requested session export is too large.", 413);
    if (error instanceof SessionExportUnsafeContentError) return errorResponse("session_export_unsafe", "The requested session cannot be exported safely.", 422);
    console.error("Unable to export session", error);
    return errorResponse("session_unavailable", "Unable to export the requested session.", 503);
  } finally {
    lock.release();
  }
}
