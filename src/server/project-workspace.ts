import { workspace } from "@/server/workspace";
import { getProject } from "@/server/projects";

const PROJECT_ID_PATTERN = /^project-[a-z0-9-]{8,80}$/;

export async function workspaceForProjectId(projectId: string | null): Promise<string> {
  if (projectId === null) return workspace;
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Project id is invalid.");
  return (await getProject(projectId)).workspacePath;
}
