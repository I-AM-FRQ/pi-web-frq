import { describe, expect, it } from "vitest";
import { projectSessionExport, SessionExportTooLargeError } from "./session-export";

function manager(entries: unknown[]) {
  return { getBranch: () => entries };
}

describe("projectSessionExport", () => {
  it("exports only safe visible user and assistant content", () => {
    const content = projectSessionExport(manager([
      { type: "message", message: { role: "user", content: "Review @{README.md}\n\n<<<pi-web:workspace-context:v1 user-chars=18>>>\n\n[Workspace reference: README.md]\nD:\\Program\\agent\\secret.txt\n[End workspace reference]\n<<<pi-web:end-workspace-context:v1>>>", timestamp: 1 } },
      { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "private chain" }, { type: "text", text: "Result at D:\\Program\\agent\\pi\\pi-web-ui\\README.md\nBearer placeholder-token-123\napiKey=\"placeholder-secret-value\"\nhttps://example.test/?token=placeholder-query-value" }], timestamp: 2 } },
      { type: "message", message: { role: "toolResult", toolName: "workspace_read", content: "tool secret", timestamp: 3 } },
      { type: "compaction", summary: "private summary", timestamp: 4 },
    ]) as never);

    expect(content).toContain("用户\nReview @{README.md}");
    expect(content).toContain("结果\nResult at D:\\Program\\agent\\pi\\pi-web-ui\\README.md");
    expect(content).toContain("Bearer [敏感内容已隐藏]");
    expect(content).toContain("apiKey=[敏感内容已隐藏]");
    expect(content).toContain("token=[敏感内容已隐藏]");
    expect(content).not.toContain("placeholder-secret-value");
    expect(content).not.toContain("placeholder-query-value");
    expect(content).not.toContain("private chain");
    expect(content).not.toContain("tool secret");
    expect(content).not.toContain("<think>");
    expect(content).not.toContain("private summary");
    expect(content).not.toContain("<<<pi-web:");
    expect(content).toMatch(/[A-Za-z]:[\\/](?!\/)/);
  });

  it("uses the requested branch and omits other branches", () => {
    const getBranch = (entryId?: string) => entryId === "a1b2c3d4" ? [
      { type: "message", message: { role: "user", content: "Preview branch", timestamp: 2 } },
    ] : [{ type: "message", message: { role: "user", content: "Active branch", timestamp: 1 } }];
    const content = projectSessionExport({ getBranch } as never, "a1b2c3d4");

    expect(content).toContain("Preview branch");
    expect(content).not.toContain("Active branch");
  });

  it("rejects exports beyond the item limit", () => {
    const entries = Array.from({ length: 2_001 }, (_, index) => ({
      type: "message",
      message: { role: "user", content: `Message ${index}`, timestamp: index },
    }));
    expect(() => projectSessionExport(manager(entries) as never)).toThrow(SessionExportTooLargeError);
  });
});
