import { NextRequest, NextResponse } from "next/server";
import { invalidateModelCache } from "@/server/pi";
import { deleteProviderConfig, ProviderConfigValidationError } from "@/server/provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    await deleteProviderConfig(providerId);
    invalidateModelCache();
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof ProviderConfigValidationError ? error.message : "Unable to delete provider configuration.";
    return NextResponse.json({ error: { code: "invalid_provider_config", message } }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
