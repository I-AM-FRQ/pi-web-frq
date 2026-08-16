import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, accessKeysEqual, getAccessKey } from "@/server/auth-key";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;

async function readLoginKey(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) return null;
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string"
      ? (value as { key: string }).key
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const key = await readLoginKey(request);
  const accessKey = await getAccessKey();
  if (!key || !accessKeysEqual(key, accessKey)) {
    return NextResponse.json({ error: { code: "invalid_key", message: "密钥不正确" } }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, key, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return response;
}