import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, accessKeysEqual, getAccessKey, regenerateAccessKey } from "@/server/auth-key";

export const runtime = "nodejs";

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
    || normalized.startsWith("localhost:") || normalized.startsWith("127.0.0.1:") || normalized.startsWith("[::1]:");
}

export async function POST(request: NextRequest) {
  const accessKey = await getAccessKey();
  const authenticated = accessKeysEqual(request.cookies.get(AUTH_COOKIE_NAME)?.value, accessKey);
  if (!isLoopbackHost(request.headers.get("host")) && !authenticated) {
    return NextResponse.json({ error: { code: "unauthorized", message: "需要访问密钥" } }, { status: 401 });
  }
  return NextResponse.json({ key: await regenerateAccessKey() });
}