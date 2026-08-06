import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

async function loadResourcesModule() {
  const root = await mkdtemp(join(tmpdir(), "pi-workbench-resources-"));
  roots.push(root);
  vi.resetModules();
  vi.stubEnv("PI_WEB_RESOURCES_DIR", root);
  return import("./agent-resources");
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Workbench agent resources", () => {
  it("creates, enables, resolves, and deletes managed skills and plugins", async () => {
    const resources = await loadResourcesModule();
    await resources.createAgentResource("skills", "release-check", "---\nname: renamed-skill\ndescription: Verify a release before deployment.\n---\n\n# Release check\nRun the release workflow.\n");
    await resources.createAgentResource("plugins", "echo-plugin");

    const created = await resources.listAgentResources();
    expect(created.skills).toEqual(expect.arrayContaining([expect.objectContaining({ id: "release-check", name: "renamed-skill", enabled: false, origin: "managed", editable: true })]));
    expect(created.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id: "echo-plugin", enabled: false, origin: "managed", editable: true })]));

    await resources.setAgentResourceConfiguration({ skills: ["release-check"], plugins: ["echo-plugin"] });
    const paths = await resources.enabledAgentResourcePaths();
    expect(paths.skillPaths).toHaveLength(1);
    expect(paths.skillInstructions[0]).toContain("Run the release workflow.");
    expect(paths.pluginPaths).toHaveLength(1);

    const { createPiServices } = await import("./pi");
    const services = await createPiServices({ skills: [], plugins: ["echo-plugin"] });
    expect(services.resourceLoader.getExtensions().extensions[0]?.tools.has("echo_plugin_echo")).toBe(true);

    const afterDelete = await resources.deleteAgentResource("skills", "release-check");
    expect(afterDelete.skills.some((item) => item.id === "release-check")).toBe(false);
    expect(afterDelete.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id: "echo-plugin", enabled: true })]));
  });

  it("scans manually configured directories as read-only resources", async () => {
    const resources = await loadResourcesModule();
    const external = await mkdtemp(join(tmpdir(), "pi-workbench-external-"));
    roots.push(external);
    await mkdir(join(external, "review-skill"));
    await writeFile(join(external, "review-skill", "SKILL.md"), "---\nname: review-skill\ndescription: Review source code.\n---\n\n# Review\nInspect the requested changes.\n");
    await mkdir(join(external, "review-plugin"));
    await writeFile(join(external, "review-plugin", "index.ts"), "export default function () {}\n");

    const configured = await resources.setAgentResourceConfiguration({ skills: [], plugins: [], directories: { skills: [external], plugins: [external] } });
    const skill = configured.skills.find((item) => item.name === "review-skill");
    const plugin = configured.plugins.find((item) => item.name === "review-plugin");
    expect(skill).toMatchObject({ origin: "configured", editable: false, enabled: false });
    expect(plugin).toMatchObject({ origin: "configured", editable: false, enabled: false });

    await resources.setAgentResourceConfiguration({ skills: [skill!.id], plugins: [plugin!.id] });
    const paths = await resources.enabledAgentResourcePaths();
    expect(paths.skillInstructions).toContain("---\nname: review-skill\ndescription: Review source code.\n---\n\n# Review\nInspect the requested changes.\n");
    expect(paths.pluginPaths).toHaveLength(1);
  });

  it("rejects unsafe resource names and oversized content", async () => {
    const resources = await loadResourcesModule();
    await expect(resources.createAgentResource("skills", "../outside")).rejects.toThrow("Resource names");
    await expect(resources.createAgentResource("plugins", "valid-name", "x".repeat(200_001))).rejects.toThrow("Resource content");
  });
});
