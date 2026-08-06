import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { workspace } from "@/server/workspace";

export type Project = {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectRegistry = { projects: Project[]; sessionProjectIds: Record<string, string> };

const PROJECT_ID_PATTERN = /^project-[a-z0-9-]{8,80}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROJECTS_PATH = process.env.PI_WEB_PROJECTS_PATH || join(homedir(), ".pi", "agent", "workbench", "projects.json");
const PROJECT_WORKSPACES_ROOT = process.env.PI_WEB_PROJECT_WORKSPACES_DIR || join(homedir(), "Documents", "Pi");
const EMPTY_REGISTRY: ProjectRegistry = { projects: [], sessionProjectIds: {} };
let writeQueue: Promise<void> = Promise.resolve();

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Project name must be text.");
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) throw new Error("Project name must be 1 to 80 characters.");
  return name;
}

function workspaceOverlaps(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const leftRelative = relative(normalizedLeft, normalizedRight);
  const rightRelative = relative(normalizedRight, normalizedLeft);
  if (isAbsolute(leftRelative) || isAbsolute(rightRelative)) return false;
  return leftRelative === "" || rightRelative === "" || (!leftRelative.startsWith("..") && !rightRelative.startsWith(".."));
}

async function resolveProjectWorkspace(value: unknown, projectName: string): Promise<string> {
  const target = value === undefined ? join(PROJECT_WORKSPACES_ROOT, projectName) : value;
  if (typeof target !== "string" || !isAbsolute(target)) throw new Error("Project workspace must be an absolute path.");
  await mkdir(resolve(target), { recursive: true });
  const path = await realpath(resolve(target));
  if (!(await stat(path)).isDirectory()) throw new Error("Project workspace must be a directory.");
  return path;
}

function normalizeRegistry(value: unknown): ProjectRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...EMPTY_REGISTRY };
  const data = value as Record<string, unknown>;
  const projects = Array.isArray(data.projects) ? data.projects.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const project = item as Record<string, unknown>;
    if (typeof project.id !== "string" || !PROJECT_ID_PATTERN.test(project.id) || typeof project.workspacePath !== "string" || !isAbsolute(project.workspacePath)) return [];
    try {
      return [{
        id: project.id,
        name: normalizeName(project.name),
        workspacePath: resolve(project.workspacePath),
        createdAt: typeof project.createdAt === "string" ? project.createdAt : new Date(0).toISOString(),
        updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : new Date(0).toISOString(),
      }];
    } catch { return []; }
  }) : [];
  const knownIds = new Set(projects.map((project) => project.id));
  const sessionProjectIds: Record<string, string> = {};
  if (typeof data.sessionProjectIds === "object" && data.sessionProjectIds !== null && !Array.isArray(data.sessionProjectIds)) {
    for (const [sessionId, projectId] of Object.entries(data.sessionProjectIds)) {
      if (SESSION_ID_PATTERN.test(sessionId) && typeof projectId === "string" && knownIds.has(projectId)) sessionProjectIds[sessionId] = projectId;
    }
  }
  return { projects, sessionProjectIds };
}

async function readRegistry(): Promise<ProjectRegistry> {
  try { return normalizeRegistry(JSON.parse(await readFile(PROJECTS_PATH, "utf8")) as unknown); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_REGISTRY };
    throw error;
  }
}

async function writeRegistry(registry: ProjectRegistry): Promise<void> {
  await mkdir(dirname(PROJECTS_PATH), { recursive: true });
  const temporaryPath = `${PROJECTS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temporaryPath, PROJECTS_PATH);
}

function serializedWrite(operation: () => Promise<void>): Promise<void> {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.catch(() => undefined);
  return pending;
}

export async function listProjects(): Promise<Project[]> {
  return [...(await readRegistry()).projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getProject(projectId: string): Promise<Project> {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id is invalid.");
  const project = (await readRegistry()).projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");
  return project;
}

export async function getSessionProjectIds(): Promise<Record<string, string>> {
  return (await readRegistry()).sessionProjectIds;
}

export async function createProject(name: string, workspacePath?: string): Promise<Project> {
  const normalized = normalizeName(name);
  const now = new Date().toISOString();
  const id = `project-${randomUUID()}`;
  const project: Project = { id, name: normalized, workspacePath: await resolveProjectWorkspace(workspacePath, normalized), createdAt: now, updatedAt: now };
  await serializedWrite(async () => {
    const registry = await readRegistry();
    if (registry.projects.some((item) => item.name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0)) throw new Error("A project with this name already exists.");
    if (workspaceOverlaps(project.workspacePath, workspace)) throw new Error("Project workspace must not overlap the default workspace.");
    if (registry.projects.some((item) => workspaceOverlaps(item.workspacePath, project.workspacePath))) throw new Error("Project workspaces must not overlap.");
    registry.projects.push(project);
    await writeRegistry(registry);
  });
  return project;
}

export async function renameProject(projectId: string, name: string): Promise<Project> {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id is invalid.");
  const normalized = normalizeName(name);
  let renamed: Project | undefined;
  await serializedWrite(async () => {
    const registry = await readRegistry();
    const project = registry.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found.");
    if (registry.projects.some((item) => item.id !== projectId && item.name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0)) throw new Error("A project with this name already exists.");
    project.name = normalized;
    project.updatedAt = new Date().toISOString();
    renamed = { ...project };
    await writeRegistry(registry);
  });
  return renamed!;
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id is invalid.");
  await serializedWrite(async () => {
    const registry = await readRegistry();
    if (!registry.projects.some((item) => item.id === projectId)) throw new Error("Project not found.");
    if (Object.values(registry.sessionProjectIds).includes(projectId)) throw new Error("Move or delete this project's sessions before deleting it.");
    registry.projects = registry.projects.filter((item) => item.id !== projectId);
    for (const [sessionId, assignedProjectId] of Object.entries(registry.sessionProjectIds)) if (assignedProjectId === projectId) delete registry.sessionProjectIds[sessionId];
    await writeRegistry(registry);
  });
}

export async function removeSessionProjectAssignment(sessionId: string): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return;
  await serializedWrite(async () => {
    const registry = await readRegistry();
    if (!(sessionId in registry.sessionProjectIds)) return;
    delete registry.sessionProjectIds[sessionId];
    await writeRegistry(registry);
  });
}

export async function assignSessionToProject(sessionId: string, projectId: string | null): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Session id is invalid.");
  if (projectId !== null && !PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id is invalid.");
  await serializedWrite(async () => {
    const registry = await readRegistry();
    if (projectId !== null && !registry.projects.some((item) => item.id === projectId)) throw new Error("Project not found.");
    if (projectId === null) delete registry.sessionProjectIds[sessionId];
    else registry.sessionProjectIds[sessionId] = projectId;
    await writeRegistry(registry);
  });
}
