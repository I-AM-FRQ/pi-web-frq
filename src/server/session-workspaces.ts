import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@/contracts";
import { getProject, getSessionProjectIds, listProjects, removeSessionProjectAssignment } from "@/server/projects";
import {
  createPersistentSession,
  deletePersistentSession,
  forkPersistentSession,
  getSessionSummary,
  listSessions,
  openPersistentSession,
  openPersistentSessionWithSummary,
} from "@/server/sessions";
import { workspace } from "@/server/workspace";

export async function workspaceForProject(projectId: string | undefined): Promise<string> {
  return projectId ? (await getProject(projectId)).workspacePath : workspace;
}

export async function projectIdForSession(sessionId: string): Promise<string | undefined> {
  return (await getSessionProjectIds())[sessionId];
}

export async function workspaceForSession(sessionId: string): Promise<string> {
  return workspaceForProject(await projectIdForSession(sessionId));
}

export async function createProjectPersistentSession(projectId?: string): Promise<SessionManager> {
  return createPersistentSession(await workspaceForProject(projectId));
}

export async function openProjectPersistentSession(sessionId: string): Promise<SessionManager> {
  return openPersistentSession(sessionId, await workspaceForSession(sessionId));
}

export async function openProjectPersistentSessionWithSummary(sessionId: string): Promise<{ sessionManager: SessionManager; session: SessionSummary }> {
  return openPersistentSessionWithSummary(sessionId, await workspaceForSession(sessionId));
}

export async function getProjectSessionSummary(sessionId: string): Promise<SessionSummary> {
  return getSessionSummary(sessionId, await workspaceForSession(sessionId));
}

export async function deleteProjectPersistentSession(sessionId: string): Promise<void> {
  await deletePersistentSession(sessionId, await workspaceForSession(sessionId));
  await removeSessionProjectAssignment(sessionId);
}

export async function forkProjectPersistentSession(sessionId: string, entryId?: string): Promise<SessionSummary> {
  return forkPersistentSession(sessionId, entryId, await workspaceForSession(sessionId));
}

export async function listAllProjectSessions(): Promise<SessionSummary[]> {
  const projects = await listProjects();
  const groups = await Promise.all([listSessions(workspace), ...projects.map((project) => listSessions(project.workspacePath))]);
  const seen = new Set<string>();
  return groups.flat().filter((session) => !seen.has(session.id) && Boolean(seen.add(session.id)));
}
