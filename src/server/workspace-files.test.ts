import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewWorkspaceFile, searchWorkspaceContent, searchWorkspaceFiles } from "./workspace-files";

let testWorkspace: string;

beforeEach(async () => {
  testWorkspace = await mkdtemp(path.join(tmpdir(), "pi-workspace-files-"));
});

afterEach(async () => {
  await rm(testWorkspace, { recursive: true, force: true });
});

describe("workspace file preview", () => {
  it("returns text, byte size, and the real total line count", async () => {
    await writeFile(path.join(testWorkspace, "notes.txt"), "first\r\nsecond\r\nthird\r\n", "utf8");

    await expect(previewWorkspaceFile("notes.txt", testWorkspace)).resolves.toEqual({
      path: "notes.txt",
      content: "first\nsecond\nthird\n",
      totalLines: 4,
      truncated: false,
      sizeBytes: 22,
      modifiedAt: expect.any(String),
    });
  });

  it("limits previews to the first 2000 lines while reporting all lines", async () => {
    const content = Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join("\n");
    await writeFile(path.join(testWorkspace, "long.txt"), content, "utf8");

    const preview = await previewWorkspaceFile("long.txt", testWorkspace);

    expect(preview.totalLines).toBe(2001);
    expect(preview.truncated).toBe(true);
    expect(preview.content.split("\n")).toHaveLength(2000);
    expect(preview.content).not.toContain("line 2001");
  });

  it("rejects oversized, binary, and unsafe paths without exposing the workspace", async () => {
    await writeFile(path.join(testWorkspace, "large.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
    await writeFile(path.join(testWorkspace, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));
    await mkdir(path.join(testWorkspace, ".private"));
    await writeFile(path.join(testWorkspace, ".private", "secret.txt"), "secret", "utf8");

    await expect(previewWorkspaceFile("large.txt", testWorkspace)).rejects.toMatchObject({ code: "too_large" });
    await expect(previewWorkspaceFile("binary.bin", testWorkspace)).rejects.toMatchObject({ code: "binary" });
    await expect(previewWorkspaceFile("../outside.txt", testWorkspace)).rejects.toMatchObject({ code: "invalid_path" });
    await expect(previewWorkspaceFile(".private/secret.txt", testWorkspace)).rejects.toMatchObject({ code: "invalid_path" });
  });
});

describe("workspace file search", () => {
  it("sorts exact names before prefixes and limits results", async () => {
    await mkdir(path.join(testWorkspace, "nested"));
    await writeFile(path.join(testWorkspace, "match"), "", "utf8");
    await writeFile(path.join(testWorkspace, "match-prefix.txt"), "", "utf8");
    await writeFile(path.join(testWorkspace, "nested", "contains-match.txt"), "", "utf8");
    await Promise.all(
      Array.from({ length: 51 }, (_, index) => writeFile(path.join(testWorkspace, `match-result-${index}.txt`), "", "utf8")),
    );

    const results = await searchWorkspaceFiles("match", testWorkspace);

    expect(results.query).toBe("match");
    expect(results.truncated).toBe(true);
    expect(results.matches).toHaveLength(50);

    const nameResults = results.matches.map((match) => match.name);
    expect(nameResults[0]).toBe("match");
    expect(results.matches.slice(0, 2).map((match) => match.name)).toEqual(["match", "match-prefix.txt"]);
    expect(results.matches.some((match) => match.path === "nested/contains-match.txt")).toBe(false);
  });

  it("rejects empty and oversized queries", async () => {
    await expect(searchWorkspaceFiles("   ", testWorkspace)).rejects.toMatchObject({ code: "invalid_query" });
    await expect(searchWorkspaceFiles("x".repeat(201), testWorkspace)).rejects.toMatchObject({ code: "invalid_query" });
  });
});

describe("workspace content search", () => {
  it("matches literal content with line numbers across nested files", async () => {
    await mkdir(path.join(testWorkspace, "src"));
    await writeFile(path.join(testWorkspace, "src", "a.ts"), "first\ntarget value\nthird", "utf8");
    await writeFile(path.join(testWorkspace, "src", "b.ts"), "nothing here", "utf8");
    await writeFile(path.join(testWorkspace, "notes.txt"), "TARGET VALUE uppercase", "utf8");

    const results = await searchWorkspaceContent("target value", { caseSensitive: false }, testWorkspace);

    expect(results.matches).toEqual([
      { path: "notes.txt", line: 1, text: "TARGET VALUE uppercase" },
      { path: "src/a.ts", line: 2, text: "target value" },
    ]);
  });

  it("respects case sensitivity, regex, and ignores binary files", async () => {
    await mkdir(path.join(testWorkspace, "src"));
    await writeFile(path.join(testWorkspace, "src", "a.ts"), "first\nExact Case\nthird", "utf8");
    await writeFile(path.join(testWorkspace, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]), "utf8");

    const caseSensitive = await searchWorkspaceContent("exact case", { caseSensitive: true }, testWorkspace);
    expect(caseSensitive.matches).toEqual([]);

    const caseInsensitive = await searchWorkspaceContent("exact case", { caseSensitive: false }, testWorkspace);
    expect(caseInsensitive.matches).toHaveLength(1);

    const regex = await searchWorkspaceContent("^Exact.*Case$", { regex: true }, testWorkspace);
    expect(regex.matches).toEqual([{ path: "src/a.ts", line: 2, text: "Exact Case" }]);

    await expect(searchWorkspaceContent("([invalid", { regex: true }, testWorkspace)).rejects.toMatchObject({ code: "invalid_query" });
  });

  it("cuts off pathological regexes instead of hanging the search", async () => {
    // 恶意/灾难性回溯正则：在长行上执行会指数级变慢。
    await writeFile(path.join(testWorkspace, "adversarial.txt"), `${"a".repeat(20_000)}b`, "utf8");
    const startedAt = Date.now();
    const results = await searchWorkspaceContent("(a+)+", { regex: true }, testWorkspace);
    // 必须在预算内返回（不抛错、不挂起），并给出截断或空结果。
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(Array.isArray(results.matches)).toBe(true);
  });
});
