import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, accessKeysEqual, getAccessKey } from "@/server/auth-key";

export const config = {
  matcher: "/api/:path*",
  runtime: "nodejs",
};

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
    || normalized.startsWith("localhost:") || normalized.startsWith("127.0.0.1:") || normalized.startsWith("[::1]:");
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (isLoopbackHost(request.headers.get("host"))) return NextResponse.next();

  const accessKey = await getAccessKey();
  if (!accessKey || accessKeysEqual(request.cookies.get(AUTH_COOKIE_NAME)?.value, accessKey)) return NextResponse.next();

  return NextResponse.json({ error: { code: "unauthorized", message: "需要访问密钥" } }, { status: 401 });
}