import { describe, expect, it } from "vitest";
import { parseSessionCommandRequest, SessionCommandValidationError } from "./session-command";

describe("parseSessionCommandRequest", () => {
  it("accepts built-in commands and a compact instruction", () => {
    expect(parseSessionCommandRequest({ command: "compact", argument: "  Keep recent errors  " })).toEqual({
      command: "compact",
      argument: "Keep recent errors",
    });
    expect(parseSessionCommandRequest({ command: "session" })).toEqual({ command: "session", argument: "" });
  });

  it("requires a name and rejects invalid command forms", () => {
    expect(() => parseSessionCommandRequest({ command: "name", argument: "" })).toThrow(SessionCommandValidationError);
    expect(() => parseSessionCommandRequest({ command: "copy", argument: "extra" })).toThrow(SessionCommandValidationError);
    expect(() => parseSessionCommandRequest({ command: "delete", argument: "" })).toThrow(SessionCommandValidationError);
    expect(() => parseSessionCommandRequest({ command: "compact", argument: "x".repeat(2_001) })).toThrow(SessionCommandValidationError);
  });
});
