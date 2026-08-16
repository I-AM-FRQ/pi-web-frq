import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const AUTH_COOKIE_NAME = "piweb_auth";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const configPath = () => process.env.PI_WEB_SERVICE_CONFIG || join(homedir(), ".pi", "agent", "workbench", "service.json");

let cachedKey: string | null = null;
let cachedMtimeMs: number | null = null;
let writeQueue: Promise<void> = Promise.resolve();

type ServiceConfigValue = Record<string, unknown>;

function accessKeyFrom(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readConfig(path: string): Promise<ServiceConfigValue> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as ServiceConfigValue : {};
  } catch {
    return {};
  }
}

async function refreshCache(path = configPath()): Promise<string | null> {
  try {
    const metadata = await stat(path);
    if (cachedMtimeMs === metadata.mtimeMs) return cachedKey;
    const config = await readConfig(path);
    cachedKey = accessKeyFrom(config.accessKey);
    cachedMtimeMs = metadata.mtimeMs;
    return cachedKey;
  } catch {
    cachedKey = null;
    cachedMtimeMs = null;
    return null;
  }
}

export function getAccessKey(): Promise<string | null> {
  return refreshCache();
}

export function createAccessKey(): string {
  return randomBytes(16).toString("hex");
}

async function atomicWriteConfig(path: string, value: ServiceConfigValue): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function setAccessKey(key: string): Promise<string> {
  const path = configPath();
  return serializeWrite(async () => {
    const config = await readConfig(path);
    config.accessKey = key;
    await atomicWriteConfig(path, config);
    const metadata = await stat(path);
    cachedKey = key;
    cachedMtimeMs = metadata.mtimeMs;
    return key;
  });
}

export async function ensureAccessKey(): Promise<string | null> {
  const existing = await getAccessKey();
  return existing ?? setAccessKey(createAccessKey());
}

export function regenerateAccessKey(): Promise<string> {
  return setAccessKey(createAccessKey());
}

export function accessKeysEqual(candidate: string | undefined, accessKey: string | null): boolean {
  if (!candidate || !accessKey || candidate.length !== accessKey.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(accessKey));
}

export function resetAuthKeyCacheForTests(): void {
  cachedKey = null;
  cachedMtimeMs = null;
}