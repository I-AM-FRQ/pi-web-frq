import { describe, expect, it } from "vitest";
import { ChatRequestValidationError, parseChatRequest } from "./chat-request";

describe("parseChatRequest", () => {
  it("accepts a short safe session ID", () => {
    expect(parseChatRequest({ prompt: "Hello", sessionId: "session_42-abc" })).toEqual({
      prompt: "Hello",
      sessionId: "session_42-abc",
      branchFromEntryId: undefined,
      model: undefined,
      thinkingLevel: undefined,
    });
  });

  it.each(["../session", "session/path", "session\\path", ".", "", "contains space", "x".repeat(129)])(
    "rejects unsafe session ID %j",
    (sessionId) => {
      expect(() => parseChatRequest({ prompt: "Hello", sessionId })).toThrow(ChatRequestValidationError);
    },
  );

  it("accepts a branch entry only with a session", () => {
    expect(parseChatRequest({ prompt: "Continue", sessionId: "session_42-abc", branchFromEntryId: "a1b2c3d4" })).toMatchObject({
      sessionId: "session_42-abc",
      branchFromEntryId: "a1b2c3d4",
    });
    expect(() => parseChatRequest({ prompt: "Continue", branchFromEntryId: "a1b2c3d4" })).toThrow(ChatRequestValidationError);
    expect(() => parseChatRequest({ prompt: "Continue", sessionId: "session_42-abc", branchFromEntryId: "../entry" })).toThrow(ChatRequestValidationError);
  });

  it("accepts an explicit resource selection and project", () => {
    expect(parseChatRequest({ prompt: "Hello", resources: { skills: ["release-check", "release-check"], plugins: ["echo-plugin"] }, projectId: "project-12345678" })).toMatchObject({
      resources: { skills: ["release-check"], plugins: ["echo-plugin"] },
      projectId: "project-12345678",
    });
  });

  it("rejects unsafe resource identifiers, cwd, paths, and other extra fields", () => {
    expect(() => parseChatRequest({ prompt: "Hello", resources: { skills: ["../outside"], plugins: [] } })).toThrow(ChatRequestValidationError);
    expect(() => parseChatRequest({ prompt: "Hello", projectId: "outside" })).toThrow(ChatRequestValidationError);
    expect(() => parseChatRequest({ prompt: "Hello", cwd: "C:\\outside" })).toThrow(ChatRequestValidationError);
    expect(() => parseChatRequest({ prompt: "Hello", path: "C:\\outside" })).toThrow(ChatRequestValidationError);
  });
});
