import { describe, expect, it, vi } from "vitest";
import { projectSessionConversation, sanitizeSubagentDetails, visibleAssistantText } from "./session-projection";
import { expandWorkspaceReferences } from "./file-references";

describe("projectSessionConversation", () => {
  it("projects safe active-branch items and excludes internal details and summaries", () => {
    const sessionManager = {
      getBranch: () => [
        {
          type: "message",
          message: { role: "user", content: "Question", timestamp: 1 },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "Answer" }],
            timestamp: 2,
            errorMessage: undefined,
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "read",
            content: [{ type: "text", text: "content" }],
            timestamp: 3,
            isError: false,
            details: { path: "C:\\secret", token: "secret" },
          },
        },
        { type: "compaction", summary: "Earlier messages", timestamp: "2026-01-01T00:00:00.000Z", details: { path: "C:\\secret" } },
        { type: "custom", customType: "extension", data: { path: "C:\\secret" } },
      ],
    };

    expect(projectSessionConversation(sessionManager as never)).toEqual({
      items: [
        { type: "user", content: "Question", timestamp: "1970-01-01T00:00:00.001Z" },
        { type: "thinking", content: "private", timestamp: "1970-01-01T00:00:00.002Z" },
        { type: "assistant", content: "Answer", timestamp: "1970-01-01T00:00:00.002Z", isError: false },
      ],
      truncated: false,
      nextOffset: null,
    });
  });

  it("uses the entry timestamp for assistant messages when it differs from message.timestamp", () => {
    const sessionManager = {
      getBranch: () => [
        {
          id: "user0001",
          type: "message",
          timestamp: "2026-08-05T14:03:10.000Z",
          message: { role: "user", content: "Question", timestamp: 1785938590000 },
        },
        {
          id: "asst0001",
          type: "message",
          timestamp: "2026-08-05T14:05:30.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Answer" }],
            // message.timestamp 在批量写盘时接近 user 消息，顶层 entry.timestamp 才是真实完成时间
            timestamp: 1785938590001,
            errorMessage: undefined,
          },
        },
      ],
    };

    const { items } = projectSessionConversation(sessionManager as never);
    expect(items[0]).toMatchObject({ type: "user", timestamp: "2026-08-05T14:03:10.000Z" });
    expect(items[1]).toMatchObject({ type: "assistant", timestamp: "2026-08-05T14:05:30.000Z" });
  });

  it("deduplicates the replaced duplicate user message in a legacy branch", () => {
    const sessionManager = {
      getBranch: () => [
        { id: "olduser01", type: "message", message: { role: "user", content: "你认为这句话是否合理", timestamp: 1 } },
        { id: "newuser01", type: "message", message: { role: "user", content: "你认为这句话是否合理", timestamp: 2 } },
      ],
    };

    expect(projectSessionConversation(sessionManager as never).items).toEqual([
      { type: "user", id: "newuser01", content: "你认为这句话是否合理", timestamp: "1970-01-01T00:00:00.002Z" },
    ]);
  });

  it("attaches the full raw tool result to its matching tool call", () => {
    const sessionManager = {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "call-1", name: "web_search", arguments: { query: "quantitative trading" } }],
            timestamp: 1,
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "web_search",
            content: [{ type: "text", text: "Result one\nResult two" }],
            details: { ignored: true },
            isError: false,
            timestamp: 2,
          },
        },
      ],
    };

    expect(projectSessionConversation(sessionManager as never).items).toEqual([
      {
        type: "tool",
        id: "call-1",
        name: "web_search",
        label: "web_search · quantitative trading",
        result: "Result one\nResult two",
        isError: false,
        timestamp: "1970-01-01T00:00:00.001Z",
      },
    ]);
  });

  it("uses the active model change for each assistant response", () => {
    const sessionManager = {
      getBranch: () => [
        { type: "model_change", provider: "first", modelId: "one", timestamp: 1 },
        { type: "message", message: { role: "assistant", content: "First", timestamp: 2 } },
        { type: "model_change", provider: "second", modelId: "two", timestamp: 3 },
        { type: "message", message: { role: "assistant", content: "Second", timestamp: 4 } },
      ],
    };

    expect(projectSessionConversation(sessionManager as never).items).toEqual([
      { type: "assistant", content: "First", timestamp: "1970-01-01T00:00:00.002Z", isError: false, model: { provider: "first", id: "one" } },
      { type: "assistant", content: "Second", timestamp: "1970-01-01T00:00:00.004Z", isError: false, model: { provider: "second", id: "two" } },
    ]);
  });

  it("restores the visible user prompt while retaining private workspace context", async () => {
    const storedPrompt = await expandWorkspaceReferences("Review @{src/long.ts}", async () => ({
      path: "src/long.ts",
      content: "line 1\nline 2",
      totalLines: 2,
      truncated: false,
      sizeBytes: 13,
      modifiedAt: "",
    }));
    const sessionManager = {
      getBranch: () => [{
        type: "message",
        message: { role: "user", content: storedPrompt, timestamp: 1 },
      }],
    };

    expect(projectSessionConversation(sessionManager as never)).toEqual({
      items: [{ type: "user", content: "Review @{src/long.ts}", timestamp: "1970-01-01T00:00:00.001Z" }],
      truncated: false,
      nextOffset: null,
    });
  });

  it("fails closed from the first legacy reasoning tag", () => {
    expect(visibleAssistantText("<thinking>private chain</thinking>Public reply")).toBe("");
    expect(visibleAssistantText("Visible reply<thinking>dangling marker")).toBe("Visible reply");
    expect(visibleAssistantText("<thinking>dangling marker")).toBe("");
    expect(visibleAssistantText("Visible<reasoning>private</reasoning>Public")).toBe("Visible");
    expect(visibleAssistantText([{ type: "thinking", thinking: "private" }, { type: "text", text: "Public reply" }])).toBe("Public reply");
    expect(visibleAssistantText([{ type: "text", text: "Visible<think>PRIVATE_REASONING</think>" }])).toBe("Visible");
  });

  it("preserves thinking before the visible response", () => {
    const sessionManager = {
      getBranch: () => [{
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "First reason" }, { type: "text", text: "Then answer" }],
          timestamp: 1,
        },
      }],
    };

    expect(projectSessionConversation(sessionManager as never).items).toEqual([
      { type: "thinking", content: "First reason", timestamp: "1970-01-01T00:00:00.001Z" },
      { type: "assistant", content: "Then answer", timestamp: "1970-01-01T00:00:00.001Z", isError: false },
    ]);
  });

  it("redacts local paths and excludes summary content", () => {
    const sessionManager = {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Read C:\\Users\\FAN\\secret.txt", timestamp: 1 } },
        { type: "message", message: { role: "assistant", content: "Located D:\\Program\\agent\\pi\\pi-web-ui\\README.md", timestamp: 2 } },
        { type: "compaction", summary: "Used /home/fan/.config", timestamp: 3 },
      ],
    };
    const output = projectSessionConversation(sessionManager as never).items.map((item) => ("content" in item ? item.content : "")).join("\n");

    expect(output).toContain("C:\\Users\\FAN\\secret.txt");
    expect(output).toContain("D:\\Program\\agent\\pi\\pi-web-ui\\README.md");
    expect(output).not.toContain("Used");
  });

  it("projects a requested branch without changing the active branch", () => {
    const getBranch = vi.fn((entryId?: string) => entryId === "a1b2c3d4" ? [{
      type: "message",
      message: { role: "user", content: "Branch question", timestamp: 2 },
    }] : [{
      type: "message",
      message: { role: "user", content: "Active question", timestamp: 1 },
    }]);
    const sessionManager = { getBranch };

    expect(projectSessionConversation(sessionManager as never, 160, "a1b2c3d4")).toEqual({
      items: [{ type: "user", content: "Branch question", timestamp: "1970-01-01T00:00:00.002Z" }],
      truncated: false,
      nextOffset: null,
    });
    expect(getBranch).toHaveBeenCalledWith("a1b2c3d4");
  });

  it("keeps only recent projected items when the history exceeds the limit", () => {
    const sessionManager = {
      getBranch: () => Array.from({ length: 4 }, (_, index) => ({
        type: "message",
        message: { role: "user", content: `Message ${index + 1}`, timestamp: index + 1 },
      })),
    };

    expect(projectSessionConversation(sessionManager as never, 2)).toEqual({
      items: [
        { type: "user", content: "Message 3", timestamp: "1970-01-01T00:00:00.003Z" },
        { type: "user", content: "Message 4", timestamp: "1970-01-01T00:00:00.004Z" },
      ],
      truncated: true,
      nextOffset: 2,
    });
    expect(projectSessionConversation(sessionManager as never, 2, undefined, 2)).toEqual({
      items: [
        { type: "user", content: "Message 1", timestamp: "1970-01-01T00:00:00.001Z" },
        { type: "user", content: "Message 2", timestamp: "1970-01-01T00:00:00.002Z" },
      ],
      truncated: false,
      nextOffset: null,
    });
  });
});

describe("sanitizeSubagentDetails", () => {
  it("extracts simplified messages from raw subagent details", () => {
    
    const details = sanitizeSubagentDetails({
      mode: "single",
      agentScope: "user",
      results: [{
        agent: "实现者",
        agentSource: "user",
        task: "回答 1+1",
        exitCode: 0,
        model: "deepseek-v4-flash",
        stopReason: "stop",
        messages: [
          { role: "user", content: [{ type: "text", text: "Task: 回答 1+1" }], timestamp: 1 },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "简单任务" },
              { type: "text", text: "答案是 2" },
              { type: "toolCall", id: "c1", name: "bash", arguments: { command: "echo hi" } },
            ],
            timestamp: 2,
          },
          { role: "toolResult", toolName: "bash", toolCallId: "c1", content: [{ type: "text", text: "hi" }], isError: false, timestamp: 3 },
        ],
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.001, contextTokens: 500, turns: 1 },
      }],
    });
    expect(details).toEqual({
      mode: "single",
      agentScope: "user",
      results: [{
        agent: "实现者",
        agentSource: "user",
        task: "回答 1+1",
        exitCode: 0,
        model: "deepseek-v4-flash",
        stopReason: "stop",
        messages: [
          { role: "user", text: "Task: 回答 1+1" },
          { role: "assistant", thinking: "简单任务", text: "答案是 2", toolCalls: [{ id: "c1", name: "bash", args: '{"command":"echo hi"}' }] },
          { role: "toolResult", toolName: "bash", toolCallId: "c1", text: "hi", isError: false },
        ],
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.001, contextTokens: 500, turns: 1 },
      }],
    });
  });

  it("truncates long text and many messages", () => {
    
    const longText = "x".repeat(5000);
    const details = sanitizeSubagentDetails({
      mode: "single",
      results: [{
        agent: "a",
        agentSource: "user",
        task: longText,
        exitCode: -1,
        messages: Array.from({ length: 50 }, (_, index) => ({ role: "user", content: [{ type: "text", text: `m${index}` }] })),
        usage: {},
      }],
    });
    const result = details!.results[0];
    expect(result.task.length).toBeLessThan(5000);
    expect(result.task).toContain("已截断");
    expect(result.messages.length).toBeLessThanOrEqual(40);
  });

  it("returns null for non-subagent details", () => {
    
    expect(sanitizeSubagentDetails(undefined)).toBeNull();
    expect(sanitizeSubagentDetails({ mode: "other", results: [] })).toBeNull();
    expect(sanitizeSubagentDetails({ mode: "parallel", results: "nope" })).toEqual({ mode: "parallel", results: [] });
  });
});
