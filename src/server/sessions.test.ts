import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { branchPersistentSession, forkPersistentSession, invalidateSessionIndex, listSessions, SessionEntryNotFoundError } from "./sessions";

afterEach(() => {
  invalidateSessionIndex();
  vi.restoreAllMocks();
});

describe("listSessions", () => {
  it("keeps a listed session visible if its file disappears before projection", async () => {
    const session: SessionInfo = {
      id: "session-1",
      path: "C:\\sessions\\session-1.jsonl",
      cwd: "C:\\workspace",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-02T00:00:00.000Z"),
      messageCount: 2,
      firstMessage: "Review @{README.md}\n\n[Workspace reference: README.md]\n# Private context\n[End workspace reference]",
      allMessagesText: "",
    };
    vi.spyOn(SessionManager, "list").mockResolvedValue([session]);
    vi.spyOn(SessionManager, "open").mockImplementation(() => {
      throw new Error("Session file disappeared");
    });

    await expect(listSessions()).resolves.toEqual([{
      id: "session-1",
      name: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      messageCount: 2,
      firstMessage: "Review @{README.md}",
      completed: false,
    }]);
  });

  it("preserves absolute paths in a summary fallback", async () => {
    const session: SessionInfo = {
      id: "session-1",
      path: "C:\\sessions\\session-1.jsonl",
      cwd: "C:\\workspace",
      name: "Review D:\\Program\\agent\\pi\\pi-web-ui",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-02T00:00:00.000Z"),
      messageCount: 2,
      firstMessage: "Open C:\\Users\\FAN\\secret.txt",
      allMessagesText: "",
    };
    vi.spyOn(SessionManager, "list").mockResolvedValue([session]);
    vi.spyOn(SessionManager, "open").mockImplementation(() => { throw new Error("Session file disappeared"); });

    const [summary] = await listSessions();
    expect(summary.name).toContain("D:\\Program\\agent");
    expect(summary.firstMessage).toContain("C:\\Users\\FAN");
    expect(summary.completed).toBe(false);
  });

  it("creates a branch copy only from a user or assistant entry", async () => {
    const session: SessionInfo = {
      id: "session-1",
      path: "C:\\sessions\\session-1.jsonl",
      cwd: "C:\\workspace",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-02T00:00:00.000Z"),
      messageCount: 2,
      firstMessage: "Question",
      allMessagesText: "",
    };
    const branchManager = {
      getEntry: vi.fn().mockReturnValue({ type: "message", message: { role: "user" } }),
      createBranchedSession: vi.fn().mockReturnValue("C:\\sessions\\branch.jsonl"),
    };
    const branchFileManager = { appendSessionInfo: vi.fn(), getSessionId: vi.fn().mockReturnValue("branch-session") };
    const summaryManager = { getBranch: vi.fn().mockReturnValue([]) };
    const branchSession = { ...session, id: "branch-session", path: "C:\\sessions\\branch.jsonl" };
    vi.spyOn(SessionManager, "list")
      .mockResolvedValueOnce([session])
      .mockResolvedValueOnce([branchSession]);
    vi.spyOn(SessionManager, "open")
      .mockReturnValueOnce(branchManager as never)
      .mockReturnValueOnce(branchFileManager as never)
      .mockReturnValueOnce(summaryManager as never);

    await expect(forkPersistentSession("session-1", "a1b2c3d4")).resolves.toMatchObject({ id: "branch-session" });
    expect(branchManager.createBranchedSession).toHaveBeenCalledWith("a1b2c3d4");
    expect(branchFileManager.appendSessionInfo).toHaveBeenCalledWith("副本：Question");
  });

  it("removes the edited user message from a real Pi session branch", () => {
    const sessionManager = SessionManager.inMemory();
    const firstUserId = sessionManager.appendMessage({ role: "user", content: "First", timestamp: 1 } as never);
    sessionManager.appendMessage({ role: "assistant", content: "First answer", timestamp: 2 } as never);
    const editedUserId = sessionManager.appendMessage({ role: "user", content: "Old prompt", timestamp: 3 } as never);

    branchPersistentSession(sessionManager, editedUserId);
    sessionManager.appendMessage({ role: "user", content: "Edited prompt", timestamp: 4 } as never);

    const contents = sessionManager.getBranch()
      .filter((entry): entry is Extract<typeof entry, { type: "message" }> => entry.type === "message" && entry.message.role === "user")
      .map((entry) => (entry.message as { content?: unknown }).content);
    expect(contents).toEqual(["First", "Edited prompt"]);

    branchPersistentSession(sessionManager, firstUserId);
    sessionManager.appendMessage({ role: "user", content: "Replacement first prompt", timestamp: 5 } as never);
    const rootContents = sessionManager.getBranch()
      .filter((entry): entry is Extract<typeof entry, { type: "message" }> => entry.type === "message" && entry.message.role === "user")
      .map((entry) => (entry.message as { content?: unknown }).content);
    expect(rootContents).toEqual(["Replacement first prompt"]);
  });

  it("replaces a selected user message by branching from its parent", () => {
    const sessionManager = {
      getEntry: vi.fn().mockReturnValue({ type: "message", parentId: "parent01", message: { role: "user" } }),
      branch: vi.fn(),
      resetLeaf: vi.fn(),
    };
    branchPersistentSession(sessionManager as never, "a1b2c3d4");
    expect(sessionManager.branch).toHaveBeenCalledWith("parent01");
    expect(sessionManager.resetLeaf).not.toHaveBeenCalled();

    sessionManager.getEntry.mockReturnValue({ type: "message", parentId: null, message: { role: "user" } });
    branchPersistentSession(sessionManager as never, "rootuser");
    expect(sessionManager.resetLeaf).toHaveBeenCalledOnce();

    sessionManager.getEntry.mockReturnValue({ type: "message", message: { role: "toolResult" } });
    expect(() => branchPersistentSession(sessionManager as never, "tool-call")).toThrow(SessionEntryNotFoundError);
  });

  it("rejects a tool or unknown entry as a branch source", async () => {
    const session: SessionInfo = {
      id: "session-1",
      path: "C:\\sessions\\session-1.jsonl",
      cwd: "C:\\workspace",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-02T00:00:00.000Z"),
      messageCount: 1,
      firstMessage: "Question",
      allMessagesText: "",
    };
    vi.spyOn(SessionManager, "list").mockResolvedValue([session]);
    vi.spyOn(SessionManager, "open").mockReturnValue({
      getEntry: () => ({ type: "message", message: { role: "toolResult" } }),
    } as never);

    await expect(forkPersistentSession("session-1", "a1b2c3d4")).rejects.toBeInstanceOf(SessionEntryNotFoundError);
  });
});
