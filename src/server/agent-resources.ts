import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep as pathSep } from "node:path";
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
  /** 技能注入模式：force = 全文注入系统提示；register = 仅注册按需加载。仅技能有效。 */
  mode?: "force" | "register";
};

export type AgentResources = {
  skills: AgentResource[];
  plugins: AgentResource[];
  directories: { skills: string[]; plugins: string[] };
};

type ResourceConfig = {
  enabledSkills: string[];
  enabledPlugins: string[];
  /** 启用技能中“强制注入”的子集（全文注入系统提示）；其余启用技能仅注册、按需加载。 */
  forcedSkillIds: string[];
  skillDirectories: string[];
  pluginDirectories: string[];
};

const RESOURCE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const RESOURCE_ROOT = process.env.PI_WEB_RESOURCES_DIR || join(homedir(), ".pi", "agent", "workbench");
const SKILLS_ROOT = join(RESOURCE_ROOT, "skills");
const PLUGINS_ROOT = join(RESOURCE_ROOT, "plugins");
const CONFIG_PATH = join(RESOURCE_ROOT, "resources.json");
// TUI（pi 命令行）的全局设置：skills / extensions 数组支持 "!模式" 排除自动发现的资源。
// Web 禁用技能/插件时自动同步该文件，TUI 执行 /reload（或新会话）后生效。
const AGENT_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const EMPTY_CONFIG: ResourceConfig = { enabledSkills: [], enabledPlugins: [], forcedSkillIds: [], skillDirectories: [], pluginDirectories: [] };
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
  const list = (key: "enabledSkills" | "enabledPlugins" | "forcedSkillIds") => Array.isArray(data[key])
    ? [...new Set(data[key].filter((entry): entry is string => typeof entry === "string" && RESOURCE_ID.test(entry)))].slice(0, 100)
    : [];
  const directories = (key: "skillDirectories" | "pluginDirectories") => Array.isArray(data[key])
    ? [...new Set(data[key].filter((entry): entry is string => typeof entry === "string" && isAbsolute(entry)))].slice(0, 50)
    : [];
  return {
    enabledSkills: list("enabledSkills"),
    enabledPlugins: list("enabledPlugins"),
    forcedSkillIds: list("forcedSkillIds"),
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

// ---- 与 TUI（pi 命令行）的资源排除同步（技能 + 插件） ----

/**
 * 读 ~/.pi/agent/settings.json 的指定键（skills / extensions）数组。
 */
async function readAgentSettingsList(key: "skills" | "extensions"): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(AGENT_SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    return Array.isArray(raw[key]) ? raw[key].filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 将 default 来源技能/插件的启用状态同步到 TUI 的 settings.json：
 * - 禁用的资源 → 确保 "!模式" 在对应数组中（TUI 自动发现时排除）
 * - 启用的资源 → 移除对应 "!模式" 条目
 * 保留用户手动添加的其他条目（普通路径、非 Web 管理的排除模式）。
 * 测试环境（PI_WEB_RESOURCES_DIR 被设置）跳过，避免污染真实用户配置。
 */
async function syncResourceExclusionsToTui(groups: Array<{ key: "skills" | "extensions"; items: Array<{ pattern: string; enabled: boolean }> }>): Promise<void> {
  if (process.env.PI_WEB_RESOURCES_DIR) return;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(AGENT_SETTINGS_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  let changed = false;
  for (const group of groups) {
    const current = Array.isArray(settings[group.key]) ? (settings[group.key] as unknown[]) : [];
    const managed = new Set(group.items.map((item) => "!" + item.pattern));
    const next: string[] = [];
    for (const entry of current) {
      if (typeof entry !== "string") continue;
      if (entry.startsWith("!") && managed.has(entry)) {
        const item = group.items.find((candidate) => "!" + candidate.pattern === entry);
        if (item && item.enabled) {
          changed = true; // 已启用 → 移除排除
          continue;
        }
      }
      next.push(entry);
    }
    for (const item of group.items) {
      if (!item.enabled && !next.includes("!" + item.pattern)) {
        next.push("!" + item.pattern);
        changed = true;
      }
    }
    settings[group.key] = [...new Set(next)];
  }
  if (!changed) return;
  await writeFile(AGENT_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

/** 计算要同步到 TUI 的技能/插件排除项（default 来源，即 ~/.pi/agent 下自动发现的）。 */
function buildTuiExclusions(resources: Awaited<ReturnType<typeof indexedResources>>) {
  const agentDir = join(homedir(), ".pi", "agent");
  return [
    {
      key: "skills" as const,
      items: resources.skills
        .filter((item) => item.origin === "default")
        .map((item) => ({ pattern: basename(dirname(item.path)), enabled: item.enabled })),
    },
    {
      key: "extensions" as const,
      items: resources.plugins
        .filter((item) => item.origin === "default")
        .map((item) => ({ pattern: toPosixRelative(agentDir, item.path), enabled: item.enabled })),
    },
  ];
}

function toPosixRelative(base: string, target: string): string {
  return relative(base, target).split(pathSep).join("/");
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
        mode: config.enabledSkills.includes(id) ? (config.forcedSkillIds.includes(id) ? "force" : "register") : undefined,
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
    ...(resource.kind === "skills" && resource.mode ? { mode: resource.mode } : {}),
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
    // 所有启用技能：注册为 available_skills（模型按需 read）
    skillPaths: skills.map((item) => item.path),
    // 技能元数据（name/description/path）：用于在系统提示中手工构造 available_skills 段。
    // pi 的 buildSystemPrompt 只在工具列表包含 "read" 时才追加该段，而 Web 使用 workspace_read，
    // 因此需要由 Web 自行追加，否则模型完全感知不到已启用的技能。
    skillDescriptors: skills.map((item) => ({ name: item.name, description: item.description, path: item.path })),
    // 仅“强制注入”技能：全文注入系统提示（常驻上下文）
    forcedSkillInstructions: skills.filter((item) => item.mode === "force").map((item) => item.content),
    pluginPaths: resources.plugins.filter((item) => selectedPlugins.has(item.id)).map((item) => item.path),
  };
}

export async function setAgentResourceConfiguration(value: { skills: string[]; plugins: string[]; forcedSkills?: string[]; directories?: { skills?: string[]; plugins?: string[] } }) {
  const skills = [...new Set(value.skills.map(assertResourceId))].slice(0, 100);
  const plugins = [...new Set(value.plugins.map(assertResourceId))].slice(0, 100);
  // 强制注入列表必须是已启用技能的子集。
  const forcedSkills = [...new Set((value.forcedSkills ?? []).map(assertResourceId).filter((id) => skills.includes(id)))].slice(0, 100);
  const previous = await readConfig();
  const skillDirectories = value.directories?.skills === undefined ? previous.skillDirectories : await configuredDirectories(value.directories.skills);
  const pluginDirectories = value.directories?.plugins === undefined ? previous.pluginDirectories : await configuredDirectories(value.directories.plugins);
  await serializeWrite(() => writeConfig({ enabledSkills: skills, enabledPlugins: plugins, forcedSkillIds: forcedSkills, skillDirectories, pluginDirectories }));
  // 同步 default 来源技能的启用/禁用到 TUI settings.json（!技能名 排除）。
  const indexed = await indexedResources({ ...(await readConfig()), enabledSkills: skills, enabledPlugins: plugins, forcedSkillIds: forcedSkills, skillDirectories, pluginDirectories });
  await syncResourceExclusionsToTui(buildTuiExclusions(indexed));
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
      forcedSkillIds: config.forcedSkillIds.filter((item) => item !== id),
    });
  });
  return listAgentResources();
}
