import { NextRequest, NextResponse } from "next/server";
import { askDecisionModel, type DecisionKind } from "@/server/decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_QUESTION_BYTES = 16 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;

/**
 * 决策/监督接口。
 * POST { kind: "decision" | "supervision", question, context? }
 * → { ok: true, model, decision } 或 { ok: false, reason, detail? }
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体格式不正确。" } }, { status: 400, headers: NO_STORE });
  }
  const payload = body as { kind?: unknown; question?: unknown; context?: unknown };
  const kind: DecisionKind = payload.kind === "supervision" ? "supervision" : "decision";
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const context = typeof payload.context === "string" ? payload.context : undefined;
  if (!question) {
    return NextResponse.json({ error: { code: "invalid_question", message: "缺少需要决策的问题。" } }, { status: 400, headers: NO_STORE });
  }
  if (Buffer.byteLength(question, "utf8") > MAX_QUESTION_BYTES) {
    return NextResponse.json({ error: { code: "question_too_large", message: "问题过长（上限 16 KiB）。" } }, { status: 400, headers: NO_STORE });
  }
  if (context && Buffer.byteLength(context, "utf8") > MAX_CONTEXT_BYTES) {
    return NextResponse.json({ error: { code: "context_too_large", message: "上下文过长（上限 64 KiB）。" } }, { status: 400, headers: NO_STORE });
  }

  const result = await askDecisionModel({ kind, question, ...(context ? { context } : {}) });
  // 未配置决策模型：返回 200 + ok:false，便于调用方降级（不当作服务错误）。
  return NextResponse.json(result, { headers: NO_STORE });
}
