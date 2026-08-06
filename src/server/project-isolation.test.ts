import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateProjectPathCache, isRestrictedProjectPath } from "./project-isolation";

vi.mock("@/server/projects", () => ({
  listProjects: vi.fn(async () => [
    { id: "project-a", name: "A", workspacePath: "C:\\root\\A", createdAt: "", updatedAt: "" },
    { id: "project-b", name: "B", workspacePath: "C:\\root\\B", createdAt: "", updatedAt: "" },
  ]),
}));

describe("project isolation", () => {
  afterEach(() => invalidateProjectPathCache());

  it("allows files inside the session's own project directory", async () => {
    expect(await isRestrictedProjectPath("C:\\root\\A\\src\\main.ts", "C:\\root\\A")).toBe(false);
    expect(await isRestrictedProjectPath("C:\\root\\A", "C:\\root\\A")).toBe(false);
  });

  it("rejects files inside other project directories from a default workspace", async () => {
    expect(await isRestrictedProjectPath("C:\\root\\A\\src\\main.ts", "C:\\root")).toBe(true);
    expect(await isRestrictedProjectPath("C:\\root\\B\\file.txt", "C:\\root\\A")).toBe(true);
  });

  it("allows non-project paths under the default workspace", async () => {
    expect(await isRestrictedProjectPath("C:\\root\\notes.md", "C:\\root")).toBe(false);
    expect(await isRestrictedProjectPath("C:\\root\\Default\\todo.txt", "C:\\root\\Default")).toBe(false);
  });
});
