import { NextRequest, NextResponse } from "next/server";
import { ensureSampleRoleCards, listRoleCards, roleCardsDirectory, writeRoleCard } from "@/server/role-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** 列出可用的角色卡（文件名即角色名，内容从 markdown 文件动态读取）。 */
export async function GET() {
  try {
    // 首次访问且目录为空时写入内置示例，方便直接使用
    await ensureSampleRoleCards();
    const cards = await listRoleCards();
    return NextResponse.json({ cards, directory: roleCardsDirectory() }, { headers: NO_STORE });
  } catch (error) {
    console.error("Unable to list role cards", error);
    return NextResponse.json({ error: { code: "role_cards_unavailable", message: "无法读取角色卡。" } }, { status: 500, headers: NO_STORE });
  }
}

/** 新建或覆盖角色卡（POST /api/role-cards { name, content }）。 */
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
  const payload = body as { name?: unknown; content?: unknown };
  try {
    const card = await writeRoleCard(payload.name as string, payload.content as string);
    return NextResponse.json({ card }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "role_card_write_failed", message: error instanceof Error ? error.message : "保存角色卡失败。" } },
      { status: 400, headers: NO_STORE },
    );
  }
}
