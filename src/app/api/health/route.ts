import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true, name: "pi-web-frq", capabilities: { sessionExport: true, providerConfig: true } }, { headers: { "Cache-Control": "no-store" } });
}
