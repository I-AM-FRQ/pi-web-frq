import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MAX_CUSTOM_SYSTEM_PROMPT_LENGTH = 40_000;
const PROJECT_PROMPT_DIRECTORY = ".pi-web";
const PROJECT_PROMPT_FILE = "project-system-prompt.md";

export function globalAgentsPath(agentDirectory = join(homedir(), ".pi", "agent")): string {
  return join(agentDirectory, "AGENTS.md");
}

export function projectSystemPromptPath(projectWorkspace: string): string {
  return join(projectWorkspace, PROJECT_PROMPT_DIRECTORY, PROJECT_PROMPT_FILE);
}

async function readPrompt(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function writePrompt(content: string, path: string): Promise<string> {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (trimmed.length > MAX_CUSTOM_SYSTEM_PROMPT_LENGTH) {
    throw new Error(`系统提示词不能超过 ${MAX_CUSTOM_SYSTEM_PROMPT_LENGTH} 字符。`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, trimmed, "utf8");
  return trimmed;
}

/** 读取全局 Pi 指令文件（~/.pi/agent/AGENTS.md）。 */
export function readGlobalAgentInstructions(path = globalAgentsPath()): Promise<string> {
  return readPrompt(path);
}

/** 保存全局 Pi 指令文件（~/.pi/agent/AGENTS.md）。 */
export function writeGlobalAgentInstructions(content: string, path = globalAgentsPath()): Promise<string> {
  return writePrompt(content, path);
}

/** 读取当前项目专属的追加系统提示词。 */
export function readProjectSystemPrompt(projectWorkspace: string): Promise<string> {
  return readPrompt(projectSystemPromptPath(projectWorkspace));
}

/** 保存当前项目专属的追加系统提示词。 */
export function writeProjectSystemPrompt(content: string, projectWorkspace: string): Promise<string> {
  return writePrompt(content, projectSystemPromptPath(projectWorkspace));
}
