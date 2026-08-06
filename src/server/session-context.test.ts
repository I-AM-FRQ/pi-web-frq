import { describe, expect, it } from "vitest";
import { projectSessionContext } from "./session-context";

describe("projectSessionContext", () => {
  it("returns only numeric and configuration metadata for the active branch", () => {
    const sessionManager = {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "PRIVATE_PROMPT" } },
        { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_REASONING" }, { type: "text", text: "Public" }] } },
        { type: "message", message: { role: "toolResult", content: "PRIVATE_TOOL" } },
        { type: "compaction", summary: "PRIVATE_SUMMARY" },
      ],
      buildSessionContext: () => ({
        messages: [{ role: "user", content: "PRIVATE_PROMPT" }],
        model: { provider: "test", modelId: "model" },
        thinkingLevel: "high",
      }),
    };

    const output = projectSessionContext(sessionManager as never, 100);
    expect(output).toMatchObject({
      scope: "active",
      entryCount: 4,
      messageCount: { user: 1, assistant: 1, tool: 1, other: 1 },
      contextWindow: 100,
      model: { provider: "test", id: "model" },
      thinkingLevel: "high",
      compacted: true,
    });
    expect(output.tokens).toBeGreaterThan(0);
    expect(output.percent).toBeGreaterThan(0);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("PRIVATE_");
  });

  it("uses the requested preview branch without changing active-session methods", () => {
    const getBranch = (entryId?: string) => entryId ? [{ type: "message", message: { role: "user", content: "preview" } }] : [];
    const sessionManager = {
      getBranch,
      getEntries: () => [],
      buildSessionContext: () => ({ messages: [], model: null, thinkingLevel: "off" }),
    };
    const output = projectSessionContext(sessionManager as never, null, "a1b2c3d4");
    expect(output).toMatchObject({ scope: "preview", entryCount: 1, contextWindow: null, percent: null, compacted: false });
    expect(getBranch("a1b2c3d4")).toHaveLength(1);
  });
});
