import { lstat, readdir, readFile, stat } from "node:fs/promises";
import type { WorkspaceContentMatch, WorkspaceContentSearchResponse, WorkspaceEntry, WorkspaceFilePreview, WorkspaceFileSearchResponse } from "../workspace-contracts";
import {
  resolveExistingWorkspacePath,
  toWorkspaceRelativePath,
  workspace,
} from "./workspace";

const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_PREVIEW_LINES = 2000;
const MAX_DIRECTORY_ENTRIES = 500;
const MAX_SEARCH_MATCHES = 50;
const MAX_SEARCH_QUERY_LENGTH = 200;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_DIRECTORIES = 500;
const IGNORED_DIRECTORY_NAMES = new Set(["node_modules", ".next", "coverage", ".turbo", "dist", "build"]);

type WorkspaceFileErrorCode = "invalid_path" | "not_found" | "too_large" | "binary" | "invalid_query";

export class WorkspaceFileError extends Error {
  constructor(public readonly code: WorkspaceFileErrorCode) {
    super(workspaceFileErrorMessage(code));
    this.name = "WorkspaceFileError";
  }
}

function workspaceFileErrorMessage(code: WorkspaceFileErrorCode): string {
  switch (code) {
    case "not_found":
      return "Workspace file was not found.";
    case "too_large":
      return "Workspace file is too large to preview.";
    case "binary":
      return "Workspace file is not UTF-8 text.";
    case "invalid_query":
      return "Workspace search query is invalid.";
    default:
      return "Workspace path is invalid or unavailable.";
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function workspaceFileErrorFrom(error: unknown): WorkspaceFileError {
  if (error instanceof WorkspaceFileError) return error;
  return new WorkspaceFileError(errorCode(error) === "ENOENT" ? "not_found" : "invalid_path");
}

async function resolveFile(relativePath: string, root: string): Promise<string> {
  try {
    return resolveExistingWorkspacePath(relativePath, root);
  } catch (error) {
    throw workspaceFileErrorFrom(error);
  }
}

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name.toLowerCase());
}

async function verifiedDirectoryEntries(relativePath: string, root: string): Promise<{ entries: WorkspaceEntry[]; truncated: boolean }> {
  const directory = await resolveFile(relativePath, root);
  try {
    if (!(await stat(directory)).isDirectory()) throw new WorkspaceFileError("invalid_path");
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    const entries: WorkspaceEntry[] = [];
    let truncated = false;

    for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink() || (entry.isDirectory() && isIgnoredDirectory(entry.name))) continue;

      const childRelativePath = relativePath === "." ? entry.name : `${relativePath}/${entry.name}`;
      try {
        const child = await resolveFile(childRelativePath, root);
        const childStatus = await lstat(child);
        if (childStatus.isSymbolicLink()) continue;
        const childType = await stat(child);
        if (!childType.isFile() && !childType.isDirectory()) continue;
        entries.push({
          name: entry.name,
          path: toWorkspaceRelativePath(child, root),
          kind: childType.isDirectory() ? "directory" : "file",
        });
      } catch {
        // Files can be removed or replaced while the directory is being read.
      }
    }
    return { entries, truncated };
  } catch (error) {
    throw workspaceFileErrorFrom(error);
  }
}

export async function listWorkspaceDirectory(relativePath = ".", root = workspace): Promise<WorkspaceEntry[]> {
  return (await verifiedDirectoryEntries(relativePath, root)).entries;
}

export async function previewWorkspaceFile(relativePath: string, root = workspace): Promise<WorkspaceFilePreview> {
  const file = await resolveFile(relativePath, root);
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new WorkspaceFileError("invalid_path");
    if (metadata.size > MAX_PREVIEW_BYTES) throw new WorkspaceFileError("too_large");

    const buffer = await readFile(file);
    if (buffer.includes(0)) throw new WorkspaceFileError("binary");

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new WorkspaceFileError("binary");
    }

    const lines = content.split(/\r\n|[\n\r]/);
    const truncated = lines.length > MAX_PREVIEW_LINES;
    return {
      path: toWorkspaceRelativePath(file, root),
      content: lines.slice(0, MAX_PREVIEW_LINES).join("\n"),
      totalLines: lines.length,
      truncated,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    };
  } catch (error) {
    throw workspaceFileErrorFrom(error);
  }
}

function normalizeSearchQuery(query: string): string {
  if (typeof query !== "string" || query.length === 0 || query.length > MAX_SEARCH_QUERY_LENGTH || query.includes("\0")) {
    throw new WorkspaceFileError("invalid_query");
  }
  const normalized = query.trim();
  if (normalized.length === 0) throw new WorkspaceFileError("invalid_query");
  return normalized;
}

function searchRank(name: string, path: string, query: string): number {
  const normalizedName = name.toLowerCase();
  const normalizedPath = path.toLowerCase();
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  return normalizedPath.includes(query) ? 2 : 3;
}

export async function searchWorkspaceFiles(query: string, root = workspace): Promise<WorkspaceFileSearchResponse> {
  const normalizedQuery = normalizeSearchQuery(query);
  const comparableQuery = normalizedQuery.toLowerCase();
  const directories = ["."];
  const matches: WorkspaceFileSearchResponse["matches"] = [];
  let scannedDirectories = 0;
  let scannedFiles = 0;
  let truncated = false;

  while (directories.length > 0) {
    if (scannedDirectories >= MAX_SEARCH_DIRECTORIES || scannedFiles >= MAX_SEARCH_FILES) {
      truncated = true;
      break;
    }

    const directory = directories.shift();
    if (!directory) break;
    scannedDirectories += 1;

    let directoryResult: { entries: WorkspaceEntry[]; truncated: boolean };
    try {
      directoryResult = await verifiedDirectoryEntries(directory, root);
    } catch (error) {
      if (directory === ".") throw workspaceFileErrorFrom(error);
      truncated = true;
      continue;
    }
    if (directoryResult.truncated) truncated = true;

    for (const entry of directoryResult.entries) {
      if (entry.kind === "directory") {
        directories.push(entry.path);
        continue;
      }
      if (scannedFiles >= MAX_SEARCH_FILES) {
        truncated = true;
        break;
      }

      scannedFiles += 1;
      const comparableName = entry.name.toLowerCase();
      const comparablePath = entry.path.toLowerCase();
      if (comparableName.includes(comparableQuery) || comparablePath.includes(comparableQuery)) {
        matches.push({ name: entry.name, path: entry.path });
      }
    }
  }

  matches.sort((left, right) => {
    const rankDifference = searchRank(left.name, left.path, comparableQuery) - searchRank(right.name, right.path, comparableQuery);
    return rankDifference !== 0 ? rankDifference : left.path.localeCompare(right.path);
  });

  if (matches.length > MAX_SEARCH_MATCHES) truncated = true;
  return { query: normalizedQuery, matches: matches.slice(0, MAX_SEARCH_MATCHES), truncated };
}

const MAX_CONTENT_SEARCH_MATCHES = 100;
const MAX_CONTENT_SEARCH_FILES = 500;
const MAX_CONTENT_SEARCH_BYTES = 8 * 1024 * 1024;
const MAX_CONTENT_LINE_LENGTH = 500;
/** 内容搜索总时间预算：恶意正则（如 (a+)+$）可能灾难性回溯，超时即截断。 */
const CONTENT_SEARCH_TIME_BUDGET_MS = 500;

type ContentSearchOptions = { caseSensitive?: boolean; regex?: boolean };

/** 在工作区 UTF-8 文本文件中搜索内容，返回命中行与行号。 */
export async function searchWorkspaceContent(query: string, options: ContentSearchOptions = {}, root = workspace): Promise<WorkspaceContentSearchResponse> {
  const normalizedQuery = normalizeSearchQuery(query);
  const caseSensitive = Boolean(options.caseSensitive);
  const regex = Boolean(options.regex);

  let matchesLine: (line: string) => boolean;
  if (regex) {
    try {
      const expression = new RegExp(normalizedQuery, caseSensitive ? "" : "i");
      matchesLine = (line) => expression.test(line);
    } catch {
      throw new WorkspaceFileError("invalid_query");
    }
  } else {
    const needle = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();
    matchesLine = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
  }

  const directories = ["."];
  const matches: WorkspaceContentMatch[] = [];
  const searchStartedAt = Date.now();
  let scannedDirectories = 0;
  let scannedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;

  // ReDoS 防护：正则执行超预算时停止搜索，避免单个请求卡死服务。
  const overTimeBudget = () => Date.now() - searchStartedAt > CONTENT_SEARCH_TIME_BUDGET_MS;

  while (directories.length > 0) {
    if (scannedDirectories >= MAX_SEARCH_DIRECTORIES || scannedFiles >= MAX_CONTENT_SEARCH_FILES) {
      truncated = true;
      break;
    }

    const directory = directories.shift();
    if (!directory) break;
    scannedDirectories += 1;

    let directoryResult: { entries: WorkspaceEntry[]; truncated: boolean };
    try {
      directoryResult = await verifiedDirectoryEntries(directory, root);
    } catch (error) {
      if (directory === ".") throw workspaceFileErrorFrom(error);
      truncated = true;
      continue;
    }
    if (directoryResult.truncated) truncated = true;

    for (const entry of directoryResult.entries) {
      if (entry.kind === "directory") {
        directories.push(entry.path);
        continue;
      }
      if (scannedFiles >= MAX_CONTENT_SEARCH_FILES) {
        truncated = true;
        break;
      }
      scannedFiles += 1;

      try {
        const absolutePath = await resolveFile(entry.path, root);
        const metadata = await stat(absolutePath);
        if (metadata.size > MAX_PREVIEW_BYTES || scannedBytes + metadata.size > MAX_CONTENT_SEARCH_BYTES) continue;
        const buffer = await readFile(absolutePath);
        if (buffer.includes(0)) continue;
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          continue;
        }
        scannedBytes += metadata.size;

        for (const [index, line] of text.split(/\r\n|[\n\r]/).entries()) {
          if (matchesLine(line)) {
            matches.push({ path: entry.path, line: index + 1, text: line.slice(0, MAX_CONTENT_LINE_LENGTH) });
            if (matches.length >= MAX_CONTENT_SEARCH_MATCHES) break;
          }
          // 每 256 行检查一次时间预算，防止恶意正则拖垮搜索。
          if ((index & 0xff) === 0 && overTimeBudget()) {
            truncated = true;
            break;
          }
        }
        if (overTimeBudget()) {
          truncated = true;
          break;
        }
        if (matches.length >= MAX_CONTENT_SEARCH_MATCHES) break;
      } catch {
        // 文件可能在扫描期间被删除或替换。
      }
    }
    if (matches.length >= MAX_CONTENT_SEARCH_MATCHES) break;
  }

  if (matches.length > MAX_CONTENT_SEARCH_MATCHES) truncated = true;
  return { query: normalizedQuery, caseSensitive, regex, matches: matches.slice(0, MAX_CONTENT_SEARCH_MATCHES), truncated };
}

export function isWorkspaceFileError(error: unknown): error is WorkspaceFileError {
  return error instanceof WorkspaceFileError;
}
