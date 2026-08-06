import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { tryLockSession } from "@/server/session-lock";
import { POST as forkPost } from "./sessions/[sessionId]/fork/route";
import { DELETE as sessionDelete, GET as sessionGet, PATCH as sessionPatch } from "./sessions/[sessionId]/route";

function request(url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(url, init);
}

function context(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

const loopbackHeaders = { host: "127.0.0.1:30142", origin: "http://127.0.0.1:30142" };

describe("session API validation and locking", () => {
  it.each([
    ["get", () => sessionGet(request("http://127.0.0.1:30142/api/sessions/..", { headers: { host: "127.0.0.1:30142" } }), context(".."))],
    ["rename", () => sessionPatch(request("http://127.0.0.1:30142/api/sessions/..", {
      method: "PATCH", headers: { ...loopbackHeaders, "content-type": "application/json" }, body: JSON.stringify({ name: "x" }),
    }), context(".."))],
    ["delete", () => sessionDelete(request("http://127.0.0.1:30142/api/sessions/..", {
      method: "DELETE", headers: loopbackHeaders,
    }), context(".."))],
    ["fork", () => forkPost(request("http://127.0.0.1:30142/api/sessions/../fork", {
      method: "POST", headers: loopbackHeaders,
    }), context(".."))],
  ])("rejects an unsafe session id for %s", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_session_id", message: "The session id is invalid." },
    });
  });

  it("rejects a malformed or non-JSON branch source before accessing the session", async () => {
    const malformed = await forkPost(request("http://127.0.0.1:30142/api/sessions/safe-session-id/fork", {
      method: "POST", headers: { ...loopbackHeaders, "content-type": "application/json" }, body: "{",
    }), context("safe-session-id"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: { code: "invalid_session_entry", message: "Request body must be valid JSON." },
    });

    const nonJson = await forkPost(request("http://127.0.0.1:30142/api/sessions/safe-session-id/fork", {
      method: "POST", headers: { ...loopbackHeaders, "content-type": "text/plain" }, body: "a1b2c3d4",
    }), context("safe-session-id"));
    expect(nonJson.status).toBe(400);
    await expect(nonJson.json()).resolves.toEqual({
      error: { code: "invalid_session_entry", message: "Fork request bodies must be JSON." },
    });
  });

  it("rejects an invalid branch preview entry before accessing the session", async () => {
    const response = await sessionGet(request("http://127.0.0.1:30142/api/sessions/safe-session-id?entryId=../outside", {
      headers: { host: "127.0.0.1:30142" },
    }), context("safe-session-id"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_session_entry", message: "entryId must be an 8-character session entry identifier." },
    });
  });

  it("rejects an invalid rename body before accessing the session", async () => {
    const response = await sessionPatch(request("http://127.0.0.1:30142/api/sessions/safe-session-id", {
      method: "PATCH",
      headers: { ...loopbackHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "\n" }),
    }), context("safe-session-id"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_session_name", message: "Session name must be 1 to 120 printable characters." },
    });
  });

  it.each([
    ["rename", () => sessionPatch(request("http://127.0.0.1:30142/api/sessions/locked-session", {
      method: "PATCH", headers: { ...loopbackHeaders, "content-type": "application/json" }, body: JSON.stringify({ name: "new name" }),
    }), context("locked-session"))],
    ["delete", () => sessionDelete(request("http://127.0.0.1:30142/api/sessions/locked-session", {
      method: "DELETE", headers: loopbackHeaders,
    }), context("locked-session"))],
    ["fork", () => forkPost(request("http://127.0.0.1:30142/api/sessions/locked-session/fork", {
      method: "POST", headers: loopbackHeaders,
    }), context("locked-session"))],
  ])("returns 409 when a session is streaming during %s", async (_name, call) => {
    const lock = tryLockSession("locked-session");
    try {
      const response = await call();
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: "session_busy", message: "The requested session is already running." },
      });
    } finally {
      lock?.release();
    }
  });
});

afterEach(() => {
  tryLockSession("locked-session")?.release();
});
