import { listProjects } from "@/server/projects";

const PROJECT_PATH_CACHE_TTL_MS = 3_000;

let cachedPaths: Set<string> | null = null;
let cachedAt = 0;

/**
 * 已注册项目的工作区路径集合（小写规范化，Windows 大小写不敏感）。
 * 短缓存避免高频浏览时反复读 projects.json；项目变更后最多 3 秒内反映。
 */
export async function projectWorkspacePaths(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedPaths && now - cachedAt < PROJECT_PATH_CACHE_TTL_MS) return cachedPaths;
  const projects = await listProjects();
  const next = new Set(projects.map((project) => project.workspacePath.toLowerCase()));
  cachedPaths = next;
  cachedAt = now;
  return next;
}

function isInsideDirectory(parentLower: string, childLower: string): boolean {
  if (childLower === parentLower) return true;
  return childLower.startsWith(`${parentLower}\\`) || childLower.startsWith(`${parentLower}/`);
}

/**
 * 项目目录隔离：
 * - 若 absolutePath 位于某个已注册项目的工作区目录内：
 *   - root 恰好是该项目目录（本项目会话）→ 允许；
 *   - 否则（无项目会话、默认工作区、其他项目）→ 受限，拒绝/隐藏。
 * 该规则不依赖默认工作区常量，因此对旧会话（cwd 位于项目根）同样生效。
 */
export async function isRestrictedProjectPath(absolutePath: string, root: string): Promise<boolean> {
  const normalizedPath = absolutePath.toLowerCase();
  const normalizedRoot = root.toLowerCase();
  const projectPaths = await projectWorkspacePaths();
  for (const projectPath of projectPaths) {
    if (!isInsideDirectory(projectPath, normalizedPath)) continue;
    // 在本项目会话中放行；否则拒绝（防止无项目/跨项目读取）。
    return normalizedRoot !== projectPath;
  }
  return false;
}

/** 供测试/失效用：清空缓存。 */
export function invalidateProjectPathCache(): void {
  cachedPaths = null;
  cachedAt = 0;
}
