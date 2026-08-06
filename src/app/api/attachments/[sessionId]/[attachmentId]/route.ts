import { NextResponse } from "next/server";
import { join } from "node:path";
import { AttachmentValidationError, downloadImageAttachment } from "@/server/attachments";
import { workspaceForSession } from "@/server/session-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string; attachmentId: string }> }) {
  try {
    const { sessionId, attachmentId } = await context.params;
    const attachment = await downloadImageAttachment(sessionId, attachmentId, join(await workspaceForSession(sessionId), ".pi-web-attachments"));
    return new NextResponse(new Uint8Array(attachment.data), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return NextResponse.json({ error: { code: "attachment_not_found", message: "Image attachment is unavailable." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Unable to read image attachment", error);
    return NextResponse.json({ error: { code: "attachment_unavailable", message: "Image attachment is unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
