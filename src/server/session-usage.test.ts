import { describe, expect, it } from "vitest";
import { projectSessionUsage } from "./session-usage";

describe("projectSessionUsage", () => {
  it("aggregates assistant, tool, and compaction usage without reading message content", () => {
    const sessionManager = {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "private" }],
            usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.01 } },
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            content: [{ type: "text", text: "private tool output" }],
            usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { total: 0.02 } },
          },
        },
        {
          type: "compaction",
          usage: { input: 7, output: 3, cacheRead: 1, cacheWrite: 0, totalTokens: 11, cost: { total: 0.03 } },
        },
        { type: "message", message: { role: "user", content: "not billed" } },
      ],
    };

    expect(projectSessionUsage(sessionManager as never)).toEqual({
      inputTokens: 20,
      outputTokens: 12,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      totalTokens: 36,
      cost: 0.06,
      usageRecords: 3,
    });
  });

  it("uses safe zeroes for invalid fields and derives missing token totals", () => {
    const sessionManager = {
      getBranch: () => [{
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 2, output: 3, cacheRead: -1, cacheWrite: Number.NaN, totalTokens: 0, cost: { total: -2 } },
        },
      }],
    };

    expect(projectSessionUsage(sessionManager as never)).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 5,
      cost: 0,
      usageRecords: 1,
    });
  });
});
