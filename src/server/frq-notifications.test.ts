import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let workspace = "";

vi.mock("@/server/session-workspaces", () => ({
  workspaceForSession: vi.fn(async () => workspace),
}));

import { acknowledgeFrqCompletionNotifications, initialFrqNotificationCursor, listFrqCompletionNotifications, readFrqCompletionNotifications } from "./frq-notifications";

const sessionId = "session-a";
const busDir = () => join(workspace, ".agent-bus");
const completion = (id: string, session = sessionId) => JSON.stringify({
  id,
  sessionId: session,
  taskId: "task-1",
  nickname: "worker",
  status: "done",
  summary: "finished",
  createdAt: 1,
  uiAcknowledgedAt: null,
  modelDeliveredAt: null,
});

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("FRQ completion notifications", () => {
  it("only applies acknowledgements written by the current session", async () => {
    workspace = await mkdtemp(join(tmpdir(), "frq-notifications-"));
    await mkdir(busDir(), { recursive: true });
    await writeFile(join(busDir(), "frq-completions.jsonl"), completion("notice-1") + "\n", "utf8");
    await writeFile(join(busDir(), "frq-completion-ui-acks.jsonl"), JSON.stringify({ id: "notice-1", sessionId: "session-b" }) + "\n", "utf8");

    expect(await listFrqCompletionNotifications(sessionId)).toHaveLength(1);
    await acknowledgeFrqCompletionNotifications(sessionId, ["notice-1"]);
    expect(await listFrqCompletionNotifications(sessionId)).toEqual([]);
  });

  it("reads only newly appended complete JSONL records after its byte cursor", async () => {
    workspace = await mkdtemp(join(tmpdir(), "frq-notifications-"));
    await mkdir(busDir(), { recursive: true });
    const file = join(busDir(), "frq-completions.jsonl");
    await writeFile(file, completion("notice-1") + "\n", "utf8");

    const first = await readFrqCompletionNotifications(sessionId, initialFrqNotificationCursor());
    expect(first.notifications.map((notice) => notice.id)).toEqual(["notice-1"]);
    const unchanged = await readFrqCompletionNotifications(sessionId, first.cursor);
    expect(unchanged.notifications).toEqual([]);

    await appendFile(file, completion("notice-2") + "\n", "utf8");
    const second = await readFrqCompletionNotifications(sessionId, unchanged.cursor);
    expect(second.notifications.map((notice) => notice.id)).toEqual(["notice-2"]);
  });
});
