import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWorkspaceGitDiff, getWorkspaceGitStatus, listWorkspaceGitBranches, listWorkspaceGitLog, parseGitDiffMode, parseGitStatus, runWorkspaceGitAction } from "./workspace-git";

let repository: string;

function git(args: string[]) {
  execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
}

beforeEach(async () => {
  repository = await mkdtemp(path.join(tmpdir(), "pi-workspace-git-"));
  git(["init"]);
  git(["config", "user.name", "Pi Workbench Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "notes.txt"), "base\n", "utf8");
  git(["add", "notes.txt"]);
  git(["commit", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe("parseGitStatus", () => {
  it("projects ordinary workspace changes and omits sensitive paths", () => {
    const status = parseGitStatus("## main...origin/main\0 M src/app.ts\0?? notes.txt\0 M .env.local\0");

    expect(status).toEqual({
      available: true,
      branch: "main",
      truncated: false,
      entries: [
        { path: "src/app.ts", indexStatus: " ", worktreeStatus: "M" },
        { path: "notes.txt", indexStatus: "?", worktreeStatus: "?" },
      ],
    });
  });

  it("does not expose traversal or absolute paths", () => {
    const status = parseGitStatus("## trunk\0 M ../outside.txt\0 M C:\\Windows\\system.ini\0");

    expect(status.entries).toEqual([]);
  });

  it("accepts only explicit read-only diff modes", () => {
    expect(parseGitDiffMode(null)).toBe("working");
    expect(parseGitDiffMode("working")).toBe("working");
    expect(parseGitDiffMode("staged")).toBe("staged");
    expect(() => parseGitDiffMode("--output=/tmp/leak")).toThrow("Git diff mode is invalid.");
  });

  it("reads independent staged and working diffs from a real temporary repository", async () => {
    await writeFile(path.join(repository, "notes.txt"), "staged\n", "utf8");
    git(["add", "notes.txt"]);
    await writeFile(path.join(repository, "notes.txt"), "working\n", "utf8");

    const [status, staged, working] = await Promise.all([
      getWorkspaceGitStatus(repository),
      getWorkspaceGitDiff("notes.txt", "staged", repository),
      getWorkspaceGitDiff("notes.txt", "working", repository),
    ]);

    expect(status.available).toBe(true);
    expect(status.entries).toContainEqual({ path: "notes.txt", indexStatus: "M", worktreeStatus: "M" });
    expect(staged).toMatchObject({ path: "notes.txt", mode: "staged", truncated: false });
    expect(staged.content).toContain("+staged");
    expect(working).toMatchObject({ path: "notes.txt", mode: "working", truncated: false });
    expect(working.content).toContain("+working");
  });

  it("stages, unstages, commits, lists branches, switches, and reads the log", async () => {
    await writeFile(path.join(repository, "notes.txt"), "next\n", "utf8");

    let status = await getWorkspaceGitStatus(repository);
    expect(status.entries).toContainEqual({ path: "notes.txt", indexStatus: " ", worktreeStatus: "M" });

    await runWorkspaceGitAction({ action: "stage", paths: ["notes.txt"] }, repository);
    status = await getWorkspaceGitStatus(repository);
    expect(status.entries).toContainEqual({ path: "notes.txt", indexStatus: "M", worktreeStatus: " " });

    await runWorkspaceGitAction({ action: "unstage", paths: ["notes.txt"] }, repository);
    status = await getWorkspaceGitStatus(repository);
    expect(status.entries).toContainEqual({ path: "notes.txt", indexStatus: " ", worktreeStatus: "M" });

    await runWorkspaceGitAction({ action: "stage", paths: ["notes.txt"] }, repository);
    await runWorkspaceGitAction({ action: "commit", message: "update notes" }, repository);
    const log = await listWorkspaceGitLog(5, repository);
    expect(log[0]).toMatchObject({ message: "update notes" });
    expect(log[1]).toMatchObject({ message: "initial" });

    git(["branch", "feature"]);
    const branches = await listWorkspaceGitBranches(repository);
    expect(branches.current).toBe("master");
    expect(branches.branches).toEqual(expect.arrayContaining(["feature"]));

    await runWorkspaceGitAction({ action: "switch", branch: "feature" }, repository);
    const afterSwitch = await listWorkspaceGitBranches(repository);
    expect(afterSwitch.current).toBe("feature");
  });

  it("rejects unsafe actions", async () => {
    await expect(runWorkspaceGitAction({ action: "stage", paths: ["../outside.txt"] }, repository)).rejects.toThrow("Git paths are invalid");
    await expect(runWorkspaceGitAction({ action: "commit", message: "" }, repository)).rejects.toThrow("Commit message is invalid");
    await expect(runWorkspaceGitAction({ action: "switch", branch: "-evil" }, repository)).rejects.toThrow("Branch name is invalid");
    await expect(runWorkspaceGitAction({ action: "switch", branch: "a b" }, repository)).rejects.toThrow("Branch name is invalid");
  });
});
