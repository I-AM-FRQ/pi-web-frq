import { NextRequest, NextResponse } from "next/server";
import { invalidateModelCache } from "@/server/pi";
import { ProviderConfigValidationError, listProviderConfigs, saveProviderConfig } from "@/server/provider-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return NextResponse.json({ providers: await listProviderConfigs() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof ProviderConfigValidationError ? error.message : "Unable to read provider configuration.";
    return errorResponse("provider_config_unavailable", message, 503);
  }
}

export async function PUT(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 128 * 1024) return errorResponse("request_too_large", "Request body is too large.", 413);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse("invalid_provider_config", "Request body must be valid JSON.", 400);
  }
  try {
    const provider = await saveProviderConfig(input);
    invalidateModelCache();
    return NextResponse.json({ provider }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof ProviderConfigValidationError ? error.message : "Unable to save provider configuration.";
    return errorResponse("invalid_provider_config", message, 400);
  }
}
