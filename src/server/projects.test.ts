import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const paths: string[] = [];

async function loadProjects() {
  const directory = await mkdtemp(join(tmpdir(), "pi-workbench-projects-"));
  const path = join(directory, "projects.json");
  paths.push(directory);
  vi.resetModules();
  vi.stubEnv("PI_WEB_PROJECTS_PATH", path);
  vi.stubEnv("PI_WEB_PROJECT_WORKSPACES_DIR", join(directory, "workspaces"));
  return import("./projects");
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Workbench projects", () => {
  it("creates, renames, assigns, and deletes projects", async () => {
    const projects = await loadProjects();
    const created = await projects.createProject("搜索工具");
    expect((await projects.listProjects())[0]).toMatchObject({ id: created.id, name: "搜索工具" });
    expect(created.workspacePath).toBe(join(paths.at(-1)!, "workspaces", "搜索工具"));
    await expect(stat(created.workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    const renamed = await projects.renameProject(created.id, "搜索工具重构");
    expect(renamed.name).toBe("搜索工具重构");
    await projects.assignSessionToProject("session_42", created.id);
    expect(await projects.getSessionProjectIds()).toEqual({ session_42: created.id });
    await expect(projects.deleteProject(created.id)).rejects.toThrow("Move or delete");
    await projects.assignSessionToProject("session_42", null);

    await projects.deleteProject(created.id);
    expect(await projects.listProjects()).toEqual([]);
    expect(await projects.getSessionProjectIds()).toEqual({});
  });

  it("rejects invalid names and project ids", async () => {
    const projects = await loadProjects();
    await expect(projects.createProject(" ")).rejects.toThrow("Project name");
    await expect(projects.assignSessionToProject("../session", null)).rejects.toThrow("Session id");
    await expect(projects.renameProject("project-invalid", "name")).rejects.toThrow("Project id");
  });
});
