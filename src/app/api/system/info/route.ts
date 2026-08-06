import { readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { workspace } from "@/server/workspace";
import { parseServicePort, parseServiceProjectRoot, parseServiceWorkspace, readServiceConfig, writeServiceConfig, DEFAULT_PROJECT_WORKSPACES_ROOT } from "@/server/service-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function lanAddresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
    }
  }
  return [...addresses];
}

function readVersion(): string {
  try {
    const version = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function GET() {
  const port = process.env.PORT && /^\d+$/.test(process.env.PORT) ? process.env.PORT : "30142";
  const saved = await readServiceConfig().catch(() => ({ port: Number(port), workspace, projectWorkspacesRoot: "" }));
  return NextResponse.json({
    host: "0.0.0.0",
    port,
    localUrl: `http://localhost:${port}`,
    lanAddresses: lanAddresses().map((address) => `http://${address}:${port}`),
    workspace,
    sessionDirectory: join(homedir(), ".pi", "agent", "sessions"),
    version: readVersion(),
    savedPort: saved.port,
    savedWorkspace: saved.workspace,
    projectWorkspacesRoot: process.env.PI_WEB_PROJECT_WORKSPACES_DIR ?? DEFAULT_PROJECT_WORKSPACES_ROOT,
    savedProjectWorkspacesRoot: saved.projectWorkspacesRoot,
  }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是合法 JSON。" } }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "invalid_request", message: "请求体必须是对象。" } }, { status: 400, headers: NO_STORE });
  }
  const input = body as { port?: unknown; workspace?: unknown; projectWorkspacesRoot?: unknown };
  if (input.port !== undefined && typeof input.port !== "number" && typeof input.port !== "string") {
    return NextResponse.json({ error: { code: "invalid_service_config", message: "端口必须是 1-65535 之间的整数。" } }, { status: 400, headers: NO_STORE });
  }
  if (input.workspace !== undefined && typeof input.workspace !== "string") {
    return NextResponse.json({ error: { code: "invalid_service_config", message: "默认工作区必须是绝对路径。" } }, { status: 400, headers: NO_STORE });
  }
  if (input.projectWorkspacesRoot !== undefined && typeof input.projectWorkspacesRoot !== "string") {
    return NextResponse.json({ error: { code: "invalid_service_config", message: "项目默认保存位置必须是绝对路径。" } }, { status: 400, headers: NO_STORE });
  }
  try {
    const patch: { port?: number; workspace?: string; projectWorkspacesRoot?: string } = {};
    if (input.port !== undefined) patch.port = parseServicePort(input.port);
    if (input.workspace !== undefined) patch.workspace = parseServiceWorkspace(input.workspace);
    if (input.projectWorkspacesRoot !== undefined) patch.projectWorkspacesRoot = parseServiceProjectRoot(input.projectWorkspacesRoot);
    const saved = await writeServiceConfig(patch);
    return NextResponse.json({ savedPort: saved.port, savedWorkspace: saved.workspace, savedProjectWorkspacesRoot: saved.projectWorkspacesRoot }, { headers: NO_STORE });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "无法保存服务配置。";
    return NextResponse.json({ error: { code: "invalid_service_config", message } }, { status: 400, headers: NO_STORE });
  }
}
