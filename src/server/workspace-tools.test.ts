import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceText } from "./workspace-tools";

let testWorkspace: string;

beforeEach(async () => {
  testWorkspace = await mkdtemp(path.join(tmpdir(), "pi-workspace-tools-"));
  await writeFile(path.join(testWorkspace, "long.txt"), "first\nsecond\nthird\nfourth", "utf8");
});

afterEach(async () => {
  await rm(testWorkspace, { recursive: true, force: true });
});

describe("workspace_read", () => {
  it("reads a bounded page so callers can continue at the next line", async () => {
    await expect(readWorkspaceText("long.txt", 2, 2, testWorkspace)).resolves.toEqual({
      text: "second\nthird",
      truncated: true,
      startLine: 2,
      totalLines: 4,
    });
  });

  it("rejects invalid UTF-8 instead of replacing bytes", async () => {
    await writeFile(path.join(testWorkspace, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await expect(readWorkspaceText("invalid.txt", undefined, undefined, testWorkspace)).rejects.toThrow("valid UTF-8");
  });
});
