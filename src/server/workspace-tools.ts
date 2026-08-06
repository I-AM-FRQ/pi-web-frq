import { constants } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { defineTool, withFileMutationQueue, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertSafeWorkspaceRelativePath, resolveExistingWorkspacePath, resolveWorkspaceMutationPath, toWorkspaceRelativePath, workspace } from "./workspace";
import { listWorkspaceDirectory as listSafeWorkspaceDirectory } from "./workspace-files";

const MAX_READ_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const MAX_FIND_ENTRIES = 500;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_FILES = 500;
const MAX_GREP_BYTES = 8 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
export const workspaceWritesEnabled = process.env.PI_WEB_ALLOW_WRITES === "true";
export const workspaceToolNames = ["workspace_read", "workspace_list", "workspace_find", "workspace_grep"];
export const enabledWorkspaceToolNames = workspaceWritesEnabled ? [...workspaceToolNames, "workspace_write", "workspace_edit"] : workspaceToolNames;
export const workspaceCapabilities = { read: true, list: true, find: true, grep: true, write: workspaceWritesEnabled, edit: workspaceWritesEnabled } as const;

function textResult(text: string) { return { content: [{ type: "text" as const, text }], details: {} }; }
function toolError(error: unknown): never { throw new Error(`Workspace operation rejected: ${error instanceof Error ? error.message : "Workspace operation was rejected."}`); }
function throwIfAborted(signal: AbortSignal | undefined) { if (signal?.aborted) throw new Error("Operation aborted."); }
function normalizeRelativePath(relativePath: string | undefined): string {
  const candidate = relativePath ?? ".";
  if (candidate !== ".") assertSafeWorkspaceRelativePath(candidate);
  return candidate;
}
function positiveInteger(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
function decodeUtf8(buffer: Buffer): string {
  if (buffer.includes(0)) throw new Error("Binary files cannot be read.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new Error("Files must be valid UTF-8 text."); }
}

export async function readWorkspaceText(relativePath: string, offset?: number, limit?: number, root = workspace): Promise<{ text: string; truncated: boolean; startLine: number; totalLines: number }> {
  const absolutePath = resolveExistingWorkspacePath(relativePath, root);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("The path must be a regular file.");
  if (metadata.size > MAX_READ_BYTES) throw new Error("Files larger than 1 MiB cannot be read.");
  const lines = decodeUtf8(await readFile(absolutePath)).split(/\r?\n/);
  const startLine = positiveInteger(offset, "offset", 1);
  const lineLimit = Math.min(positiveInteger(limit, "limit", MAX_READ_LINES), MAX_READ_LINES);
  const startIndex = startLine - 1;
  if (startIndex >= lines.length) throw new Error(`offset exceeds the file's ${lines.length} lines.`);
  return { text: lines.slice(startIndex, startIndex + lineLimit).join("\n"), truncated: startIndex + lineLimit < lines.length, startLine, totalLines: lines.length };
}

async function collectFiles(relativePath: string, limit: number, root: string, signal?: AbortSignal): Promise<string[]> {
  const results: string[] = [];
  const directories = [normalizeRelativePath(relativePath)];
  let visited = 0;
  while (directories.length && results.length < limit && visited < limit) {
    visited += 1;
    throwIfAborted(signal);
    const directory = directories.shift();
    if (!directory) break;
    for (const entry of await listSafeWorkspaceDirectory(directory, root)) {
      throwIfAborted(signal);
      if (entry.kind === "directory") directories.push(entry.path);
      else results.push(entry.path);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function globToRegExp(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") { index += 1; expression += "(?:.*/)?"; } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${expression}$`, "i");
}

function applyEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string {
  const matches = edits.map((edit) => {
    if (!edit.oldText) throw new Error("Edit oldText must not be empty.");
    const index = content.indexOf(edit.oldText);
    if (index === -1 || index !== content.lastIndexOf(edit.oldText)) throw new Error("Each edit oldText must match exactly once.");
    return { ...edit, index };
  }).sort((left, right) => left.index - right.index);
  for (let index = 1; index < matches.length; index += 1) if (matches[index - 1].index + matches[index - 1].oldText.length > matches[index].index) throw new Error("Edit replacements must not overlap.");
  return [...matches].reverse().reduce((next, edit) => `${next.slice(0, edit.index)}${edit.newText}${next.slice(edit.index + edit.oldText.length)}`, content);
}

export function createWorkspaceTools(root: string): ToolDefinition[] {
  const read = defineTool({
    name: "workspace_read", label: "workspace_read", description: "Read UTF-8 text from the active project workspace. Paths must be relative.",
    parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_LINES })) }),
    execute: async (_id, { path, offset, limit }, signal) => {
      try { throwIfAborted(signal); const result = await readWorkspaceText(path, offset, limit, root); const more = result.truncated ? `[More lines remain: read offset ${result.startLine + result.text.split("\n").length} (file has ${result.totalLines} lines)]\n` : ""; return textResult(`${more}${result.text}`); } catch (error) { return toolError(error); }
    },
  });
  const list = defineTool({
    name: "workspace_list", label: "workspace_list", description: "List direct files and directories in the active project workspace.", parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async (_id, { path }, signal) => { try { throwIfAborted(signal); const entries = await listSafeWorkspaceDirectory(normalizeRelativePath(path), root); return textResult(entries.map((entry) => `${entry.kind}\t${entry.path}`).join("\n") || "(empty)"); } catch (error) { return toolError(error); } },
  });
  const find = defineTool({
    name: "workspace_find", label: "workspace_find", description: "Find files by a simple glob in the active project workspace.", parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
    execute: async (_id, { pattern, path }, signal) => { try { if (!pattern || pattern.length > 256 || pattern.includes("\0")) throw new Error("Find pattern is invalid."); const files = await collectFiles(normalizeRelativePath(path), MAX_FIND_ENTRIES, root, signal); return textResult(files.filter((file) => globToRegExp(pattern).test(file)).slice(0, MAX_FIND_ENTRIES).join("\n") || "(no matches)"); } catch (error) { return toolError(error); } },
  });
  const grep = defineTool({
    name: "workspace_grep", label: "workspace_grep", description: "Search literal text in UTF-8 files in the active project workspace.", parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()), ignoreCase: Type.Optional(Type.Boolean()) }),
    execute: async (_id, { pattern, path, ignoreCase }, signal) => {
      try {
        if (!pattern || pattern.length > 512 || pattern.includes("\0")) throw new Error("Grep pattern is invalid.");
        const needle = ignoreCase ? pattern.toLocaleLowerCase() : pattern;
        const matches: string[] = []; let bytes = 0;
        for (const file of await collectFiles(normalizeRelativePath(path), MAX_GREP_FILES, root, signal)) {
          throwIfAborted(signal); const absolutePath = resolveExistingWorkspacePath(file, root); const metadata = await stat(absolutePath);
          if (metadata.size > MAX_READ_BYTES || bytes + metadata.size > MAX_GREP_BYTES) continue;
          let text: string; try { text = decodeUtf8(await readFile(absolutePath)); } catch { continue; } bytes += metadata.size;
          for (const [index, line] of text.split(/\r?\n/).entries()) { if ((ignoreCase ? line.toLocaleLowerCase() : line).includes(needle)) matches.push(`${file}:${index + 1}:${line.slice(0, 500)}`); if (matches.length >= MAX_GREP_MATCHES) break; }
          if (matches.length >= MAX_GREP_MATCHES) break;
        }
        return textResult(matches.join("\n") || "(no matches)");
      } catch (error) { return toolError(error); }
    },
  });
  const tools: ToolDefinition[] = [read, list, find, grep];
  if (!workspaceWritesEnabled) return tools;
  const write = defineTool({
    name: "workspace_write", label: "workspace_write", description: "Create or replace one UTF-8 text file in the active project workspace.", parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id, { path, content }, signal) => { try { if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) throw new Error("Write content exceeds 1 MiB."); const target = resolveWorkspaceMutationPath(path, root); return await withFileMutationQueue(target, async () => { throwIfAborted(signal); await writeFile(target, content, "utf8"); return textResult(`Wrote ${toWorkspaceRelativePath(target, root)}.`); }); } catch (error) { return toolError(error); } },
  });
  const edit = defineTool({
    name: "workspace_edit", label: "workspace_edit", description: "Make exact non-overlapping replacements in an active project workspace file.", parameters: Type.Object({ path: Type.String(), edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() }), { minItems: 1 }) }),
    execute: async (_id, { path, edits }, signal) => { try { const target = resolveExistingWorkspacePath(path, root); return await withFileMutationQueue(target, async () => { throwIfAborted(signal); await access(target, constants.R_OK | constants.W_OK); const original = await readFile(target); if (original.length > MAX_WRITE_BYTES) throw new Error("Only UTF-8 text files up to 1 MiB can be edited."); const next = applyEdits(decodeUtf8(original), edits); if (Buffer.byteLength(next, "utf8") > MAX_WRITE_BYTES) throw new Error("Edited content exceeds 1 MiB."); await writeFile(target, next, "utf8"); return textResult(`Edited ${toWorkspaceRelativePath(target, root)}.`); }); } catch (error) { return toolError(error); } },
  });
  return [...tools, write, edit];
}

export const enabledWorkspaceTools = createWorkspaceTools(workspace);
export async function listWorkspaceDirectory(relativePath = ".", root = workspace) { return listSafeWorkspaceDirectory(normalizeRelativePath(relativePath), root); }
