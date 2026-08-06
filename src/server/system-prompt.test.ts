import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globalAgentsPath, projectSystemPromptPath, readGlobalAgentInstructions, readProjectSystemPrompt, writeGlobalAgentInstructions, writeProjectSystemPrompt } from "./system-prompt";

const directories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "pi-workbench-system-prompt-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("system prompt storage", () => {
  it("reads and writes the global AGENTS.md file", async () => {
    const directory = await temporaryDirectory();
    const path = globalAgentsPath(directory);

    await expect(readGlobalAgentInstructions(path)).resolves.toBe("");
    await expect(writeGlobalAgentInstructions("  Always reply in Chinese.  ", path)).resolves.toBe("Always reply in Chinese.");
    await expect(readFile(path, "utf8")).resolves.toBe("Always reply in Chinese.");
  });

  it("keeps each project prompt in its own workspace", async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();

    await writeProjectSystemPrompt("First project only", first);
    await writeProjectSystemPrompt("Second project only", second);

    await expect(readProjectSystemPrompt(first)).resolves.toBe("First project only");
    await expect(readProjectSystemPrompt(second)).resolves.toBe("Second project only");
    await expect(readFile(projectSystemPromptPath(first), "utf8")).resolves.toBe("First project only");
  });
});
