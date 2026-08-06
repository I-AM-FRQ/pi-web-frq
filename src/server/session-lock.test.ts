import { describe, expect, it } from "vitest";
import { tryLockSession } from "./session-lock";

describe("tryLockSession", () => {
  it("excludes concurrent work for the same session and releases once", () => {
    const first = tryLockSession("session-a");
    expect(first).toBeDefined();
    expect(tryLockSession("session-a")).toBeUndefined();
    expect(tryLockSession("session-b")).toBeDefined();

    first?.release();
    first?.release();
    expect(tryLockSession("session-a")).toBeDefined();
  });
});
