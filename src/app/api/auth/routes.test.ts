import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, accessKeysEqual, createAccessKey, ensureAccessKey, getAccessKey, regenerateAccessKey, resetAuthKeyCacheForTests } from "@/server/auth-key";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let configPath = "";

beforeEach(async () => {
  configPath = join(await mkdtemp(join(tmpdir(), "pi-web-auth-")), "service.json");
  process.env.PI_WEB_SERVICE_CONFIG = configPath;
  resetAuthKeyCacheForTests();
});

afterEach(async () => {
  delete process.env.PI_WEB_SERVICE_CONFIG;
  resetAuthKeyCacheForTests();
  await rm(join(configPath, ".."), { recursive: true, force: true });
});

describe("auth key", () => {
  it("creates a key and reloads it when service.json mtime changes", async () => {
    await writeFile(configPath, '{"port":30142}', "utf8");
    const generated = await ensureAccessKey();
    expect(generated).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ port: 30142, accessKey: generated });

    await writeFile(configPath, '{"accessKey":"replacement-key"}', "utf8");
    const later = new Date(Date.now() + 1000);
    await utimes(configPath, later, later);
    expect(await getAccessKey()).toBe("replacement-key");
  });
});

describe("auth routes", () => {
  it("accepts the configured key and sets a persistent httpOnly cookie", async () => {
    await writeFile(configPath, '{"accessKey":"correct-key"}', "utf8");
    const { POST } = await import("./login/route");
    const response = await POST(new NextRequest("http://remote.example/api/auth/login", { method: "POST", body: JSON.stringify({ key: "correct-key" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_COOKIE_NAME}=correct-key`);
    expect(response.headers.get("set-cookie")).toContain(`Max-Age=${AUTH_COOKIE_MAX_AGE}`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects an incorrect key", async () => {
    await writeFile(configPath, '{"accessKey":"correct-key"}', "utf8");
    const { POST } = await import("./login/route");
    const response = await POST(new NextRequest("http://remote.example/api/auth/login", { method: "POST", body: JSON.stringify({ key: "wrong-key" }) }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "invalid_key", message: "密钥不正确" } });
  });

  it("regenerates the configured key for an authenticated request", async () => {
    await writeFile(configPath, '{"workspace":"C:/workspace","accessKey":"old-key"}', "utf8");
    const { POST } = await import("./regenerate/route");
    const response = await POST(new NextRequest("http://remote.example/api/auth/regenerate", { method: "POST", headers: { cookie: `${AUTH_COOKIE_NAME}=old-key` } }));
    expect(response.status).toBe(200);
    const { key } = await response.json() as { key: string };
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toBe("old-key");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ workspace: "C:/workspace", accessKey: key });
  });
});