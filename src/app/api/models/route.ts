import { NextResponse } from "next/server";
import type { ModelDescriptor } from "@/contracts";
import { getAvailableModels, thinkingLevelsFor } from "@/server/pi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models: ModelDescriptor[] = (await getAvailableModels()).map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      thinkingLevels: thinkingLevelsFor(model),
    }));
    return NextResponse.json({ models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to list available Pi models", error);
    return NextResponse.json(
      { error: { code: "models_unavailable", message: "Unable to list available models." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
