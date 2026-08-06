import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { workspace } from "@/server/workspace";

export type ServiceConfig = {
  port: number;
  workspace: string;
  projectWorkspacesRoot: string;
};

export type ServiceConfigPatch = Partial<ServiceConfig>;

export const CONFIG_PATH = process.env.PI_WEB_SERVICE_CONFIG || join(homedir(), ".pi", "agent", "workbench", "service.json");

export const DEFAULT_PROJECT_WORKSPACES_ROOT = join(homedir(), "Documents", "Pi");

const DEFAULT_PORT = 30142;

/** 将 ~ 或 ~/ 前缀展开为用户目录，再返回规范化的绝对路径。 */
export function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function parseConfig(raw: string): Partial<ServiceConfig> {
  try {
    const value = JSON.parse(raw) as { port?: unknown; workspace?: unknown; projectWorkspacesRoot?: unknown };
    const result: Partial<ServiceConfig> = {};
    if (typeof value.port === "number" && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535) result.port = value.port;
    if (typeof value.workspace === "string" && value.workspace.trim().length > 0) result.workspace = value.workspace.trim();
    if (typeof value.projectWorkspacesRoot === "string" && value.projectWorkspacesRoot.trim().length > 0) result.projectWorkspacesRoot = value.projectWorkspacesRoot.trim();
    return result;
  } catch {
    return {};
  }
}

/** 读取保存的服务配置；缺失时返回当前生效值。 */
export async function readServiceConfig(): Promise<ServiceConfig> {
  try {
    const saved = parseConfig(await readFile(CONFIG_PATH, "utf8"));
    return {
      port: saved.port ?? DEFAULT_PORT,
      workspace: saved.workspace ?? workspace,
      projectWorkspacesRoot: saved.projectWorkspacesRoot ?? process.env.PI_WEB_PROJECT_WORKSPACES_DIR ?? DEFAULT_PROJECT_WORKSPACES_ROOT,
    };
  } catch {
    return { port: DEFAULT_PORT, workspace, projectWorkspacesRoot: process.env.PI_WEB_PROJECT_WORKSPACES_DIR ?? DEFAULT_PROJECT_WORKSPACES_ROOT };
  }
}

/** 校验端口：1-65535 的整数，且不同于保留端口。 */
export function parseServicePort(value: unknown): number {
  const port = typeof value === "string" && /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1-65535 之间的整数。");
  return port;
}

/** 校验工作区路径：支持 ~ 前缀，必须解析为绝对路径；返回规范化后的路径。 */
export function parseServiceWorkspace(value: unknown): string {
  if (typeof value !== "string") throw new Error("默认工作区必须是绝对路径。");
  const expanded = expandHomePath(value);
  if (!expanded || !isAbsolute(expanded)) throw new Error("默认工作区必须是绝对路径。");
  return resolve(expanded);
}

/** 校验项目默认保存位置：支持 ~ 前缀，必须解析为绝对路径；返回规范化后的路径。 */
export function parseServiceProjectRoot(value: unknown): string {
  if (typeof value !== "string") throw new Error("项目默认保存位置必须是绝对路径。");
  const expanded = expandHomePath(value);
  if (!expanded || !isAbsolute(expanded)) throw new Error("项目默认保存位置必须是绝对路径。");
  return resolve(expanded);
}

/** 串行化写操作，避免并发 PUT 交错写入损坏配置。 */
let writeQueue: Promise<void> = Promise.resolve();

function serializedWrite(operation: () => Promise<void>): Promise<void> {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.catch(() => undefined);
  return pending;
}

/** 原子写入：先写临时文件再 rename，中断/崩溃不会留下半截 JSON。 */
async function atomicWriteJson(value: unknown) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const temporary = `${CONFIG_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, CONFIG_PATH);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeServiceConfig(patch: ServiceConfigPatch): Promise<ServiceConfig> {
  const current = await readServiceConfig();
  const next: ServiceConfig = { ...current, ...patch };
  await serializedWrite(() => atomicWriteJson(next));
  return next;
}
