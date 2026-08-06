import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafeWorkspaceRelativePath, workspace } from "./workspace";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const MAX_GIT_STATUS_ENTRIES = 250;
const MAX_GIT_DIFF_BYTES = 256 * 1024;
const MAX_GIT_MESSAGE_LENGTH = 2000;
const MAX_GIT_LOG_ENTRIES = 50;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/\-]*$/;

export type WorkspaceGitStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type WorkspaceGitStatus = {
  available: boolean;
  branch?: string;
  entries: WorkspaceGitStatusEntry[];
  truncated: boolean;
};

export type WorkspaceGitDiffMode = "working" | "staged";

export type WorkspaceGitDiff = {
  path: string;
  mode: WorkspaceGitDiffMode;
  content: string;
  truncated: boolean;
};

export type WorkspaceGitAction =
  | { action: "stage"; paths: string[] }
  | { action: "unstage"; paths: string[] }
  | { action: "commit"; message: string }
  | { action: "switch"; branch: string };

export type WorkspaceGitCommit = {
  hash: string;
  message: string;
};

export type WorkspaceGitBranches = {
  current: string | null;
  branches: string[];
};

function normalizedPath(path: string): string | undefined {
  const candidate = path.replace(/\\/g, "/");
  try {
    assertSafeWorkspaceRelativePath(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function errorOutput(error: unknown, field: "stderr" | "stdout"): string | undefined {
  if (!(error instanceof Error) || !(field in error)) return undefined;
  const value = (error as Error & Partial<Record<"stderr" | "stdout", unknown>>)[field];
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : undefined;
}

function isNotRepository(error: unknown): boolean {
  return /not a git repository/i.test(errorOutput(error, "stderr") ?? "");
}

async function runGit(args: string[], maxBuffer = MAX_GIT_OUTPUT_BYTES, root = workspace): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, "-c", "core.fsmonitor=false", ...args], {
    encoding: "buffer",
    maxBuffer,
    windowsHide: true,
  });
  return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout;
}

export function parseGitStatus(output: string): WorkspaceGitStatus {
  const records = output.split("\0");
  const branchRecord = records.shift() ?? "";
  const branch = branchRecord.startsWith("## ") ? branchRecord.slice(3).split("...")[0]?.trim() : undefined;
  const entries: WorkspaceGitStatusEntry[] = [];
  let truncated = false;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4) continue;
    const path = normalizedPath(record.slice(3));
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    if ((indexStatus === "R" || indexStatus === "C") && index + 1 < records.length) index += 1;
    if (!path) continue;
    if (entries.length >= MAX_GIT_STATUS_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push({ path, indexStatus, worktreeStatus });
  }

  return { available: true, branch, entries, truncated };
}

export async function getWorkspaceGitStatus(root = workspace): Promise<WorkspaceGitStatus> {
  try {
    const output = await runGit(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], MAX_GIT_OUTPUT_BYTES, root);
    return parseGitStatus(output);
  } catch (error) {
    if (isNotRepository(error)) return { available: false, entries: [], truncated: false };
    throw error;
  }
}

export function parseGitDiffMode(value: string | null): WorkspaceGitDiffMode {
  if (value === null || value === "working") return "working";
  if (value === "staged") return "staged";
  throw new Error("Git diff mode is invalid.");
}

export async function getWorkspaceGitDiff(relativePath: string, mode: WorkspaceGitDiffMode = "working", root = workspace): Promise<WorkspaceGitDiff> {
  const path = normalizedPath(relativePath);
  if (!path) throw new Error("Workspace path is invalid or unavailable.");

  const modeArgs = mode === "staged" ? ["--cached"] : [];
  let content: string;
  try {
    content = await runGit(["diff", "--no-ext-diff", "--no-textconv", "--unified=3", ...modeArgs, "--", path], MAX_GIT_DIFF_BYTES, root);
  } catch (error) {
    if (isNotRepository(error)) throw new Error("Workspace is not a Git repository.");
    const stdout = errorOutput(error, "stdout");
    if (stdout === undefined) throw error;
    content = stdout;
  }

  return {
    path,
    mode,
    content,
    truncated: Buffer.byteLength(content, "utf8") >= MAX_GIT_DIFF_BYTES,
  };
}

function normalizedPaths(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 250) throw new Error("Git paths are invalid.");
  return values.map((value) => {
    if (typeof value !== "string") throw new Error("Git paths are invalid.");
    const path = normalizedPath(value);
    if (!path) throw new Error("Git paths are invalid.");
    return path;
  });
}

function validateCommitMessage(message: unknown): string {
  if (typeof message !== "string" || message.trim().length === 0 || message.length > MAX_GIT_MESSAGE_LENGTH) {
    throw new Error("Commit message is invalid.");
  }
  return message.trim();
}

function validateBranchName(branch: unknown): string {
  if (typeof branch !== "string" || !BRANCH_PATTERN.test(branch)) throw new Error("Branch name is invalid.");
  return branch;
}

/** 执行 Git 写操作并返回操作后的 status 输出。 */
export async function runWorkspaceGitAction(action: WorkspaceGitAction, root = workspace): Promise<string> {
  let args: string[];
  switch (action.action) {
    case "stage":
      args = ["add", "--", ...normalizedPaths(action.paths)];
      break;
    case "unstage":
      args = ["reset", "--", ...normalizedPaths(action.paths)];
      break;
    case "commit":
      args = ["commit", "-m", validateCommitMessage(action.message)];
      break;
    case "switch":
      args = ["checkout", validateBranchName(action.branch)];
      break;
  }
  await runGit(args, MAX_GIT_OUTPUT_BYTES, root);
  return await runGit(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], MAX_GIT_OUTPUT_BYTES, root);
}

export async function listWorkspaceGitBranches(root = workspace): Promise<WorkspaceGitBranches> {
  try {
    const output = await runGit(["branch", "--format=%(HEAD)|%(refname:short)"], MAX_GIT_OUTPUT_BYTES, root);
    const branches: string[] = [];
    let current: string | null = null;
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const separator = line.indexOf("|");
      if (separator < 0) continue;
      const isHead = line.slice(0, separator) === "*";
      const name = line.slice(separator + 1);
      if (!name || !BRANCH_PATTERN.test(name)) continue;
      if (isHead) current = name;
      branches.push(name);
    }
    return { current, branches };
  } catch (error) {
    if (isNotRepository(error)) return { current: null, branches: [] };
    throw error;
  }
}

export async function listWorkspaceGitLog(limit = 20, root = workspace): Promise<WorkspaceGitCommit[]> {
  const count = Math.min(Math.max(1, limit), MAX_GIT_LOG_ENTRIES);
  try {
    const output = await runGit(["log", "--format=%h|%s", `-n ${count}`], MAX_GIT_OUTPUT_BYTES, root);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf("|");
      return separator >= 0
        ? { hash: line.slice(0, separator), message: line.slice(separator + 1) }
        : { hash: line, message: "" };
    });
  } catch (error) {
    if (isNotRepository(error)) return [];
    throw error;
  }
}
