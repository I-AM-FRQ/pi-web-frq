import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { tryLockSession } from "@/server/session-lock";
import { POST } from "./route";

function request(url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(url, init);
}

function context(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

const headers = { host: "127.0.0.1:30142", origin: "http://127.0.0.1:30142", "content-type": "application/json" };

describe("session export route", () => {
  it("rejects an unsafe session ID before opening a session", async () => {
    const response = await POST(request("http://127.0.0.1:30142/api/sessions/../export", {
      method: "POST", headers, body: "{}",
    }), context(".."));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_session_id", message: "The session id is invalid." },
    });
  });

  it("rejects an unsafe preview entry before opening a session", async () => {
    const response = await POST(request("http://127.0.0.1:30142/api/sessions/safe-session-id/export", {
      method: "POST", headers, body: JSON.stringify({ entryId: "../outside" }),
    }), context("safe-session-id"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_session_export", message: "entryId must be an 8-character session entry identifier." },
    });
  });

  it("returns 409 while the session is running", async () => {
    const lock = tryLockSession("locked-session");
    try {
      const response = await POST(request("http://127.0.0.1:30142/api/sessions/locked-session/export", {
        method: "POST", headers, body: "{}",
      }), context("locked-session"));
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
