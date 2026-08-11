import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentDescriptor } from "@/contracts";
import { getProject } from "@/server/projects";
import { workspace } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_DIR_NAME = ".pi";

type AgentFile = { name: string; description: string; tools?: string[]; model?: string; systemPrompt: string; source: "user" | "project" };

async function loadAgentsFromDir(dir: string, source: "user" | "project"): Promise<AgentFile[]> {
  const agents: AgentFile[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return agents;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = join(dir, entry.name);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;
    const tools = frontmatter.tools
      ?.split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body.trim(),
      source,
    });
  }
  return agents;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 从 cwd 向上查找最近的 .pi/agents 目录（与 subagent 扩展的项目级 agent 发现一致）。 */
async function findNearestProjectAgentsDir(cwd: string): Promise<string | null> {
  let current = cwd;
  for (let depth = 0; depth < 30; depth += 1) {
    const candidate = join(current, CONFIG_DIR_NAME, "agents");
    if (await isDirectory(candidate)) return candidate;
    const parent = join(current, "..");
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const scope = url.searchParams.get("scope") || "user";

  let cwd = workspace;
  if (projectId) {
    try {
      cwd = (await getProject(projectId)).workspacePath;
    } catch {
      return NextResponse.json({ error: { code: "project_not_found", message: "Project not found." } }, { status: 404 });
    }
  }

  const userDir = join(homedir(), ".pi", "agent", "agents");
  const projectAgentsDir = scope === "user" ? null : await findNearestProjectAgentsDir(cwd);

  const byName = new Map<string, AgentFile>();
  if (scope !== "project") {
    for (const agent of await loadAgentsFromDir(userDir, "user")) byName.set(agent.name, agent);
  }
  if (projectAgentsDir) {
    for (const agent of await loadAgentsFromDir(projectAgentsDir, "project")) byName.set(agent.name, agent);
  }

  const agents: AgentDescriptor[] = Array.from(byName.values()).map(({ name, description, tools, model, systemPrompt, source }) => ({
    name,
    description,
    source,
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    systemPrompt,
  }));

  return NextResponse.json({ agents, projectAgentsDir, cwd: basename(cwd) }, { headers: { "Cache-Control": "no-store" } });
}
