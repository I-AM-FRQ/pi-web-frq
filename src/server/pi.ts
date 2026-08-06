import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@/contracts";
import { workspace } from "@/server/workspace";
import { createWorkspaceTools, enabledWorkspaceToolNames } from "@/server/workspace-tools";
import { enabledAgentResourcePaths } from "@/server/agent-resources";
import { readProjectSystemPrompt } from "@/server/system-prompt";

// Built-in coding tools accept absolute paths and are intentionally excluded.
// Only the workspace-scoped custom tools below are available to the model.
const ALLOWED_TOOLS = enabledWorkspaceToolNames;

export type AvailableModel = Model<Api>;

const MODEL_CACHE_TTL_MS = 30_000;
let modelCache: { expiresAt: number; models: AvailableModel[] } | null = null;
let modelLoad: Promise<AvailableModel[]> | null = null;

export function invalidateModelCache() {
  modelCache = null;
  modelLoad = null;
}

export async function createPiServices(resources?: { skills?: string[]; plugins?: string[] }, root = workspace) {
  const paths = await enabledAgentResourcePaths(resources);
  const projectPrompt = await readProjectSystemPrompt(root);
  return createAgentSessionServices({
    cwd: root,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: paths.skillPaths,
      additionalExtensionPaths: paths.pluginPaths,
      appendSystemPrompt: [
        ...paths.skillInstructions.map((instruction) => `Enabled pi-web-frq skill instructions:\n${instruction}`),
        ...(projectPrompt ? [`Project-specific instructions:\n${projectPrompt}`] : []),
      ],
    },
  });
}

export async function getAvailableModels(): Promise<AvailableModel[]> {
  if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;
  if (modelLoad) return modelLoad;
  modelLoad = (async () => {
    const services = await createPiServices();
    const models = [...(await services.modelRuntime.getAvailable())];
    modelCache = { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
    return models;
  })();
  try {
    return await modelLoad;
  } finally {
    modelLoad = null;
  }
}

export function thinkingLevelsFor(model: AvailableModel): ThinkingLevel[] {
  return getSupportedThinkingLevels(model) as ThinkingLevel[];
}

export async function getWorkspaceSystemPrompt(root = workspace, resources?: { skills?: string[]; plugins?: string[] }) {
  const model = (await getAvailableModels())[0];
  if (!model) throw new Error("No models are available.");
  const created = await createChatSession(model, undefined, undefined, resources, root);
  try {
    return created.session.systemPrompt;
  } finally {
    created.session.dispose();
  }
}

export async function createChatSession(
  model: AvailableModel,
  thinkingLevel?: ThinkingLevel,
  sessionManager?: SessionManager,
  resources?: { skills?: string[]; plugins?: string[] },
  root = workspace,
) {
  const services = await createPiServices(resources, root);
  const extensionTools = services.resourceLoader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
  return createAgentSessionFromServices({
    services,
    sessionManager: sessionManager ?? SessionManager.inMemory(root),
    model,
    thinkingLevel,
    tools: [...ALLOWED_TOOLS, ...extensionTools],
    customTools: createWorkspaceTools(root),
  });
}
