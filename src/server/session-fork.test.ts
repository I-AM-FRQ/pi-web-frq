import { describe, expect, it } from "vitest";
import { parseSessionForkRequest, SessionForkValidationError } from "./session-fork";

describe("parseSessionForkRequest", () => {
  it("accepts an 8-character session entry id", () => {
    expect(parseSessionForkRequest({ entryId: "a1b2C3d4" })).toBe("a1b2C3d4");
  });

  it.each([
    undefined,
    {},
    { entryId: "" },
    { entryId: "short" },
    { entryId: "../../x" },
    { entryId: "a1b2c3d4", extra: true },
  ])("rejects an invalid fork request %j", (value) => {
    if (value === undefined) {
      expect(parseSessionForkRequest(value)).toBeUndefined();
      return;
    }
    expect(() => parseSessionForkRequest(value)).toThrow(SessionForkValidationError);
  });
});
