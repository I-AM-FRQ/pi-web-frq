import { describe, expect, it } from "vitest";
import { projectSessionTree } from "./session-tree";

describe("projectSessionTree", () => {
  it("projects branch structure without private thinking, tool details, or workspace context", () => {
    const sessionManager = {
      getTree: () => [{
        entry: {
          type: "message",
          id: "user-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "user",
            content: "Review @{README.md}\n\n[Workspace reference: README.md]\nsecret body\n[End workspace reference]",
          },
        },
        children: [{
          entry: {
            type: "message",
            id: "assistant-1",
            timestamp: "2026-01-01T00:00:01.000Z",
            message: {
              role: "assistant",
              content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Public answer" }],
            },
          },
          children: [{
            entry: {
              type: "message",
              id: "tool-1",
              timestamp: "2026-01-01T00:00:02.000Z",
              message: {
                role: "toolResult",
                toolName: "workspace_read",
                content: [{ type: "text", text: "file contents" }],
                details: { path: "C:\\secret", token: "secret" },
              },
            },
            children: [],
          }],
        }],
      }],
    };

    expect(projectSessionTree(sessionManager as never)).toEqual({
      tree: [{
        id: "user-1",
        kind: "user",
        label: "Review @{README.md}",
        timestamp: "2026-01-01T00:00:00.000Z",
        children: [{
          id: "assistant-1",
          kind: "assistant",
          label: "Public answer",
          timestamp: "2026-01-01T00:00:01.000Z",
          children: [],
        }],
      }],
      truncated: false,
    });
  });

  it("preserves local paths in tree labels", () => {
    const sessionManager = {
      getTree: () => [{
        entry: {
          type: "message",
          id: "assistant-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { role: "assistant", content: "See D:\\Program\\agent\\pi\\pi-web-ui\\README.md" },
        },
        children: [],
      }],
    };

    const output = JSON.stringify(projectSessionTree(sessionManager as never));
    expect(output).toContain("D:\\\\Program\\\\agent");
  });

  it("removes tool nodes from an oversized tree window", () => {
    const sessionManager = {
      getTree: () => [{
        entry: { type: "message", id: "user-1", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "Question" } },
        children: [],
      }, {
        entry: { type: "message", id: "tool-1", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "toolResult", toolName: "workspace_read", content: "private" } },
        children: [],
      }, {
        entry: { type: "message", id: "assistant-1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: "Public" } },
        children: [],
      }],
    };

    expect(projectSessionTree(sessionManager as never, 2)).toEqual({
      tree: [{ id: "assistant-1", kind: "assistant", label: "Public", timestamp: "2026-01-01T00:00:02.000Z", children: [] }],
      truncated: true,
    });
  });

  it("returns a flat recent-node window for oversized trees", () => {
    const sessionManager = {
      getTree: () => Array.from({ length: 4 }, (_, index) => ({
        entry: {
          type: "message",
          id: `node-${index + 1}`,
          timestamp: `2026-01-01T00:00:0${index}.000Z`,
          message: { role: "assistant", content: `Reply ${index + 1}` },
        },
        children: [],
      })),
    };

    expect(projectSessionTree(sessionManager as never, 2)).toEqual({
      tree: [
        { id: "node-3", kind: "assistant", label: "Reply 3", timestamp: "2026-01-01T00:00:02.000Z", children: [] },
        { id: "node-4", kind: "assistant", label: "Reply 4", timestamp: "2026-01-01T00:00:03.000Z", children: [] },
      ],
      truncated: true,
    });
  });
});
