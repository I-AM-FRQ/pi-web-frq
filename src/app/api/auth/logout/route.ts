import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/server/auth-key";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", { httpOnly: true, path: "/", sameSite: "lax", maxAge: 0 });
  return response;
}