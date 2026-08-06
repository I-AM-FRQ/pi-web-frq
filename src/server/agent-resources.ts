import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { workspace } from "@/server/workspace";

export type AgentResourceKind = "skills" | "plugins";
type ResourceOrigin = "managed" | "default" | "configured";

type IndexedResource = AgentResource & { path: string };

export type AgentResource = {
  id: string;
  kind: AgentResourceKind;
  name: string;
  description: string;
  enabled: boolean;
  content: string;
  origin: ResourceOrigin;
  editable: boolean;
};

export type AgentResources = {
  skills: AgentResource[];
  plugins: AgentResource[];
  directories: { skills: string[]; plugins: string[] };
};

type ResourceConfig = {
  enabledSkills: string[];
  enabledPlugins: string[];
  skillDirectories: string[];
  pluginDirectories: string[];
};

const RESOURCE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const RESOURCE_ROOT = process.env.PI_WEB_RESOURCES_DIR || join(homedir(), ".pi", "agent", "workbench");
const SKILLS_ROOT = join(RESOURCE_ROOT, "skills");
const PLUGINS_ROOT = join(RESOURCE_ROOT, "plugins");
const CONFIG_PATH = join(RESOURCE_ROOT, "resources.json");
const EMPTY_CONFIG: ResourceConfig = { enabledSkills: [], enabledPlugins: [], skillDirectories: [], pluginDirectories: [] };
let writeQueue: Promise<void> = Promise.resolve();

function rootFor(kind: AgentResourceKind) {
  return kind === "skills" ? SKILLS_ROOT : PLUGINS_ROOT;
}

function defaultDirectories(kind: AgentResourceKind): string[] {
  if (kind === "skills") {
    return [
      join(homedir(), ".pi", "agent", "skills"),
      join(homedir(), ".agents", "skills"),
      join(workspace, ".pi", "skills"),
      join(workspace, ".agents", "skills"),
    ];
  }
  return [join(homedir(), ".pi", "agent", "extensions"), join(workspace, ".pi", "extensions")];
}

function assertResourceName(value: string): string {
  if (!RESOURCE_NAME.test(value) || value.length > 64) throw new Error("Resource names must use lowercase letters, digits, and single hyphens.");
  return value;
}

function assertResourceId(value: string): string {
  if (!RESOURCE_ID.test(value)) throw new Error("Resource identifiers are invalid.");
  return value;
}

function resourceId(kind: AgentResourceKind, path: string, origin: ResourceOrigin): string {
  if (origin === "managed") return kind === "skills" ? basename(dirname(path)) : basename(dirname(path));
  const digest = createHash("sha256").update(path).digest("hex").slice(0, 24);
  return `${kind === "skills" ? "skill" : "plugin"}-${digest}`;
}

function defaultSkill(name: string) {
  return `---\nname: ${name}\ndescription: Describe the workflow this skill provides and when the agent should use it.\n---\n\n# ${name}\n\nAdd the workflow, constraints, and references the agent should follow.\n`;
}

function defaultPlugin(name: string) {
  const toolName = `${name.replace(/-/g, "_")}_echo`;
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\nimport { Type } from "typebox";\n\nexport default function (pi: ExtensionAPI) {\n  pi.registerTool({\n    name: "${toolName}",\n    label: "${toolName}",\n    description: "Replace this sample tool with the plugin capability.",\n    parameters: Type.Object({ text: Type.String({ description: "Text to return." }) }),\n    async execute(_toolCallId, { text }) {\n      return { content: [{ type: "text", text }], details: {} };\n    },\n  });\n}\n`;
}

async function ensureRoots() {
  await Promise.all([mkdir(SKILLS_ROOT, { recursive: true }), mkdir(PLUGINS_ROOT, { recursive: true })]);
}

function normalizeConfig(value: unknown): ResourceConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...EMPTY_CONFIG };
  const data = value as Record<string, unknown>;
  const list = (key: "enabledSkills" | "enabledPlugins") => Array.isArray(data[key])
    ? [...new Set(data[key].filter((entry): entry is string => typeof entry === "string" && RESOURCE_ID.test(entry)))].slice(0, 100)
    : [];
  const directories = (key: "skillDirectories" | "pluginDirectories") => Array.isArray(data[key])
    ? [...new Set(data[key].filter((entry): entry is string => typeof entry === "string" && isAbsolute(entry)))].slice(0, 50)
    : [];
  return {
    enabledSkills: list("enabledSkills"),
    enabledPlugins: list("enabledPlugins"),
    skillDirectories: directories("skillDirectories"),
    pluginDirectories: directories("pluginDirectories"),
  };
}

async function readConfig(): Promise<ResourceConfig> {
  try {
    return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_CONFIG };
    throw error;
  }
}

async function writeConfig(config: ResourceConfig): Promise<void> {
  await mkdir(RESOURCE_ROOT, { recursive: true });
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporaryPath, CONFIG_PATH);
}

function serializeWrite(operation: () => Promise<void>): Promise<void> {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.catch(() => undefined);
  return pending;
}

async function existingDirectory(path: string): Promise<string | null> {
  try {
    const resolved = await realpath(path);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function configuredDirectories(value: string[]): Promise<string[]> {
  if (value.length > 50) throw new Error("At most 50 scan directories are allowed.");
  const paths: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isAbsolute(entry)) throw new Error("Scan directories must be absolute paths.");
    const path = await existingDirectory(resolve(entry));
    if (!path) throw new Error("Each scan directory must exist and be a directory.");
    paths.push(path);
  }
  return [...new Set(paths)];
}

async function scanDirectories(kind: AgentResourceKind, config: ResourceConfig): Promise<Array<{ path: string; origin: ResourceOrigin }>> {
  const configured = kind === "skills" ? config.skillDirectories : config.pluginDirectories;
  const candidates: Array<{ path: string; origin: ResourceOrigin }> = [
    { path: rootFor(kind), origin: "managed" },
    ...defaultDirectories(kind).map((path) => ({ path, origin: "default" as const })),
    ...configured.map((path) => ({ path, origin: "configured" as const })),
  ];
  const seen = new Set<string>();
  const available: Array<{ path: string; origin: ResourceOrigin }> = [];
  for (const candidate of candidates) {
    const path = await existingDirectory(candidate.path);
    if (path && !seen.has(path)) {
      seen.add(path);
      available.push({ path, origin: candidate.origin });
    }
  }
  return available;
}

async function indexedSkills(config: ResourceConfig): Promise<IndexedResource[]> {
  const results: IndexedResource[] = [];
  const seen = new Set<string>();
  for (const source of await scanDirectories("skills", config)) {
    const loaded = loadSkillsFromDir({ dir: source.path, source: `pi-workbench-${source.origin}` }).skills;
    for (const skill of loaded) {
      const path = await realpath(skill.filePath);
      if (seen.has(path)) continue;
      seen.add(path);
      const id = resourceId("skills", path, source.origin);
      results.push({
        id,
        kind: "skills",
        name: skill.name,
        description: skill.description,
        enabled: config.enabledSkills.includes(id),
        content: await readFile(path, "utf8"),
        origin: source.origin,
        editable: source.origin === "managed",
        path,
      });
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

async function pluginFiles(directory: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const rootIndex = join(directory, "index.ts");
    if ((await stat(rootIndex)).isFile()) results.push(rootIndex);
  } catch {
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts") && entry.name !== "index.ts") results.push(join(directory, entry.name));
    if (entry.isDirectory()) {
      const path = join(directory, entry.name, "index.ts");
      try {
        if ((await stat(path)).isFile()) results.push(path);
      } catch {
      }
    }
  }
  return results;
}

async function indexedPlugins(config: ResourceConfig): Promise<IndexedResource[]> {
  const results: IndexedResource[] = [];
  const seen = new Set<string>();
  for (const source of await scanDirectories("plugins", config)) {
    for (const candidate of await pluginFiles(source.path)) {
      const path = await realpath(candidate);
      if (seen.has(path)) continue;
      seen.add(path);
      const id = resourceId("plugins", path, source.origin);
      results.push({
        id,
        kind: "plugins",
        name: basename(dirname(path)) === basename(path, ".ts") ? basename(path, ".ts") : basename(dirname(path)),
        description: `Extension module: ${basename(path)}`,
        enabled: config.enabledPlugins.includes(id),
        content: await readFile(path, "utf8"),
        origin: source.origin,
        editable: source.origin === "managed",
        path,
      });
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

function publicResources(resources: IndexedResource[]): AgentResource[] {
  return resources.map((resource) => ({
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    description: resource.description,
    enabled: resource.enabled,
    content: resource.content,
    origin: resource.origin,
    editable: resource.editable,
  }));
}

async function indexedResources(config: ResourceConfig) {
  await ensureRoots();
  const [skills, plugins] = await Promise.all([indexedSkills(config), indexedPlugins(config)]);
  return { skills, plugins };
}

export async function listAgentResources(): Promise<AgentResources> {
  const config = await readConfig();
  const resources = await indexedResources(config);
  return {
    skills: publicResources(resources.skills),
    plugins: publicResources(resources.plugins),
    directories: { skills: config.skillDirectories, plugins: config.pluginDirectories },
  };
}

export async function enabledAgentResourcePaths(selection?: { skills?: string[]; plugins?: string[] }) {
  const config = await readConfig();
  const selectedSkills = new Set(selection?.skills ?? config.enabledSkills);
  const selectedPlugins = new Set(selection?.plugins ?? config.enabledPlugins);
  const resources = await indexedResources(config);
  const skills = resources.skills.filter((item) => selectedSkills.has(item.id));
  return {
    skillPaths: skills.map((item) => item.path),
    skillInstructions: skills.map((item) => item.content),
    pluginPaths: resources.plugins.filter((item) => selectedPlugins.has(item.id)).map((item) => item.path),
  };
}

export async function setAgentResourceConfiguration(value: { skills: string[]; plugins: string[]; directories?: { skills?: string[]; plugins?: string[] } }) {
  const skills = [...new Set(value.skills.map(assertResourceId))].slice(0, 100);
  const plugins = [...new Set(value.plugins.map(assertResourceId))].slice(0, 100);
  const previous = await readConfig();
  const skillDirectories = value.directories?.skills === undefined ? previous.skillDirectories : await configuredDirectories(value.directories.skills);
  const pluginDirectories = value.directories?.plugins === undefined ? previous.pluginDirectories : await configuredDirectories(value.directories.plugins);
  await serializeWrite(() => writeConfig({ enabledSkills: skills, enabledPlugins: plugins, skillDirectories, pluginDirectories }));
  return listAgentResources();
}

export async function createAgentResource(kind: AgentResourceKind, name: string, content?: string) {
  const id = assertResourceName(name);
  if (content !== undefined && (typeof content !== "string" || content.length > 200_000)) throw new Error("Resource content must be text shorter than 200000 characters.");
  const target = join(rootFor(kind), id, kind === "skills" ? "SKILL.md" : "index.ts");
  await serializeWrite(async () => {
    await ensureRoots();
    try {
      await readFile(target, "utf8");
      throw new Error("A resource with this name already exists.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content ?? (kind === "skills" ? defaultSkill(id) : defaultPlugin(id)), "utf8");
  });
  return listAgentResources();
}

async function managedResourcePath(kind: AgentResourceKind, id: string) {
  const name = assertResourceName(id);
  return join(rootFor(kind), name, kind === "skills" ? "SKILL.md" : "index.ts");
}

export async function updateAgentResource(kind: AgentResourceKind, name: string, content: string) {
  if (typeof content !== "string" || content.length > 200_000) throw new Error("Resource content must be text shorter than 200000 characters.");
  const target = await managedResourcePath(kind, name);
  await serializeWrite(async () => {
    await readFile(target, "utf8");
    await writeFile(target, content, "utf8");
  });
  return listAgentResources();
}

export async function deleteAgentResource(kind: AgentResourceKind, name: string) {
  const id = assertResourceName(name);
  const target = join(rootFor(kind), id);
  await serializeWrite(async () => {
    await rm(target, { recursive: true, force: true });
    const config = await readConfig();
    await writeConfig({
      ...config,
      enabledSkills: config.enabledSkills.filter((item) => item !== id),
      enabledPlugins: config.enabledPlugins.filter((item) => item !== id),
    });
  });
  return listAgentResources();
}
