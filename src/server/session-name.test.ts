import { describe, expect, it } from "vitest";
import { parseSessionNameRequest, SessionNameValidationError } from "./session-name";

describe("parseSessionNameRequest", () => {
  it("trims and accepts a printable session name", () => {
    expect(parseSessionNameRequest({ name: "  修复登录流程  " })).toBe("修复登录流程");
  });

  it.each([
    {},
    { name: "" },
    { name: "   " },
    { name: "has\nnewline" },
    { name: "x".repeat(121) },
    { name: "valid", extra: true },
  ])("rejects invalid request %j", (request) => {
    expect(() => parseSessionNameRequest(request)).toThrow(SessionNameValidationError);
  });
});
