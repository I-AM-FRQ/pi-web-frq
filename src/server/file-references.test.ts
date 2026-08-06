import { describe, expect, it } from "vitest";
import { expandWorkspaceReferences, visibleWorkspacePrompt } from "./file-references";

describe("workspace prompt references", () => {
  it("marks truncated whole-file context and preserves the visible prompt", async () => {
    const prompt = "Review @{src/long.ts}";
    const expanded = await expandWorkspaceReferences(prompt, async () => ({
      path: "src/long.ts",
      content: "line 1\nline 2",
      totalLines: 2500,
      truncated: true,
      sizeBytes: 20_000,
      modifiedAt: "",
    }));

    expect(expanded).toContain("[Workspace reference: src/long.ts]");
    expect(expanded).toContain("this file has 2500 lines; only lines 1-2000 are included");
    expect(expanded).toContain('workspace_read with path "src/long.ts" and offset 2001');
    expect(visibleWorkspacePrompt(expanded)).toBe(prompt);
  });

  it("does not claim truncation for an explicit range within the preview", async () => {
    const expanded = await expandWorkspaceReferences("Review @{src/long.ts}#L2-L2", async () => ({
      path: "src/long.ts",
      content: "line 1\nline 2",
      totalLines: 2500,
      truncated: true,
      sizeBytes: 20_000,
      modifiedAt: "",
    }));

    expect(expanded).toContain("[Workspace reference: src/long.ts#L2]");
    expect(expanded).not.toContain("Preview truncated:");
  });

  it("restores the visible prompt from legacy complete workspace suffixes", () => {
    expect(visibleWorkspacePrompt("Review @{README.md}#L1\n\n[Workspace reference: README.md#L1]\n# Pi Workbench\n[End workspace reference]")).toBe(
      "Review @{README.md}#L1",
    );
  });

  it("leaves normal and incomplete content unchanged", () => {
    expect(visibleWorkspacePrompt("Hello\n<<<pi-web:workspace-context:v1 user-chars=5>>>\nnot closed")).toBe(
      "Hello\n<<<pi-web:workspace-context:v1 user-chars=5>>>\nnot closed",
    );
  });

  it("fails closed when a complete internal suffix has a malformed length", () => {
    const content = "Review @{README.md}\n\n<<<pi-web:workspace-context:v1 user-chars=1>>>\n\n[Workspace reference: README.md]\nD:\\Program\\agent\\private.txt\n[End workspace reference]\n<<<pi-web:end-workspace-context:v1>>>";
    expect(visibleWorkspacePrompt(content)).toBe("Review @{README.md}");
  });
});
