import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let workspace = "";

vi.mock("@/server/session-workspaces", () => ({
  workspaceForSession: vi.fn(async () => workspace),
}));

import { readFrqSessionActivities } from "./frq-activity";

const sessionId = "session-a";
const busDir = () => join(workspace, ".agent-bus");
const activity = (id: string, session = sessionId) => JSON.stringify({ id, sessionId: session, type: "run-start", createdAt: 1 });

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("FRQ session activity", () => {
  it("reads only newly appended complete records after its byte cursor", async () => {
    workspace = await mkdtemp(join(tmpdir(), "frq-activity-"));
    await mkdir(busDir(), { recursive: true });
    const file = join(busDir(), "session-activity.jsonl");
    await writeFile(file, activity("activity-1") + "\n", "utf8");

    const first = await readFrqSessionActivities(sessionId);
    expect(first.activities.map((entry) => entry.id)).toEqual(["activity-1"]);
    const unchanged = await readFrqSessionActivities(sessionId, first.cursor);
    expect(unchanged.activities).toEqual([]);

    await appendFile(file, activity("activity-2") + "\n", "utf8");
    const second = await readFrqSessionActivities(sessionId, unchanged.cursor);
    expect(second.activities.map((entry) => entry.id)).toEqual(["activity-2"]);
  });
});
