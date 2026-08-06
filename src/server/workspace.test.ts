import { describe, expect, it } from "vitest";
import { assertSafeWorkspaceRelativePath, isSensitiveWorkspacePath } from "./workspace";

describe("workspace path validation", () => {
  it("accepts ordinary relative paths", () => {
    expect(() => assertSafeWorkspaceRelativePath("src/server/workspace.ts")).not.toThrow();
    expect(() => assertSafeWorkspaceRelativePath("nested\\file.txt")).not.toThrow();
  });

  it.each([
    "",
    "../outside.txt",
    "nested/../outside.txt",
    "/etc/passwd",
    "\\\\server\\share\\file.txt",
    "C:\\Windows\\system.ini",
    "file\0name.txt",
    ".git/config",
    ".pi/auth.json",
    ".env.local",
    "keys/id_ed25519",
  ])("rejects unsafe path %j", (unsafePath) => {
    expect(() => assertSafeWorkspaceRelativePath(unsafePath)).toThrow();
  });

  it("identifies sensitive credential paths", () => {
    expect(isSensitiveWorkspacePath(".aws/credentials")).toBe(true);
    expect(isSensitiveWorkspacePath("certs/deploy.pem")).toBe(true);
    expect(isSensitiveWorkspacePath("src/index.ts")).toBe(false);
  });
});
