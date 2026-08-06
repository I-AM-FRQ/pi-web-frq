import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_PROVIDERS = 64;
const MAX_MODELS_PER_PROVIDER = 64;
const MAX_JSON_BYTES = 512 * 1024;
const SUPPORTED_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);

type ModelsJson = { providers: Record<string, StoredProvider> };
type StoredProvider = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  authHeader?: boolean;
  models?: StoredModel[];
};
type StoredModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
  authHeader: boolean;
  models: Array<{
    id: string;
    name: string;
    reasoning: boolean;
    acceptsImages: boolean;
    contextWindow: number;
    maxTokens: number;
  }>;
};

export type ProviderConfigSummary = Omit<ProviderConfig, "apiKey"> & { hasApiKey: boolean };

export class ProviderConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigValidationError";
  }
}

let writeChain: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new ProviderConfigValidationError(`${label} is required and too long.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxLength);
}

function validUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProviderConfigValidationError("Base URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ProviderConfigValidationError("Base URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new ProviderConfigValidationError("Base URL must not include credentials.");
  return parsed.toString().replace(/\/$/, "");
}

function parseModel(value: unknown): StoredModel {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "name", "reasoning", "acceptsImages", "contextWindow", "maxTokens"].includes(key))) {
    throw new ProviderConfigValidationError("Model configuration is invalid.");
  }
  const id = requiredText(value.id, "Model ID", 160);
  const name = optionalText(value.name, "Model name", 160);
  if (value.reasoning !== undefined && typeof value.reasoning !== "boolean") throw new ProviderConfigValidationError("Model reasoning is invalid.");
  if (value.acceptsImages !== undefined && typeof value.acceptsImages !== "boolean") throw new ProviderConfigValidationError("Model image input is invalid.");
  const integer = (candidate: unknown, label: string, fallback: number, maximum: number) => {
    if (candidate === undefined) return fallback;
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) throw new ProviderConfigValidationError(`${label} is invalid.`);
    return candidate;
  };
  return {
    id,
    ...(name ? { name } : {}),
    reasoning: value.reasoning === true,
    input: value.acceptsImages === true ? ["text", "image"] : ["text"],
    contextWindow: integer(value.contextWindow, "Context window", 128_000, 2_000_000),
    maxTokens: integer(value.maxTokens, "Maximum output tokens", 16_384, 1_000_000),
  };
}

export function parseProviderConfig(value: unknown): ProviderConfig {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "name", "baseUrl", "api", "apiKey", "authHeader", "models"].includes(key))) {
    throw new ProviderConfigValidationError("Provider configuration is invalid.");
  }
  const id = requiredText(value.id, "Provider ID", 64).toLowerCase();
  if (!PROVIDER_ID_PATTERN.test(id) || id === "__proto__" || id === "constructor" || id === "prototype") throw new ProviderConfigValidationError("Provider ID is invalid.");
  const api = requiredText(value.api, "API", 64);
  if (!SUPPORTED_APIS.has(api)) throw new ProviderConfigValidationError("API type is unsupported.");
  if (!Array.isArray(value.models) || value.models.length > MAX_MODELS_PER_PROVIDER) {
    throw new ProviderConfigValidationError(`Provider may include at most ${MAX_MODELS_PER_PROVIDER} models.`);
  }
  const models = value.models.map(parseModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new ProviderConfigValidationError("Model IDs must be unique per provider.");
  const apiKey = optionalText(value.apiKey, "API key", 16_000);
  if (value.authHeader !== undefined && typeof value.authHeader !== "boolean") throw new ProviderConfigValidationError("Authorization setting is invalid.");
  return {
    id,
    name: requiredText(value.name, "Provider name", 120),
    baseUrl: validUrl(requiredText(value.baseUrl, "Base URL", 2_000)),
    api,
    ...(apiKey ? { apiKey } : {}),
    authHeader: value.authHeader !== false,
    models: models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: model.reasoning === true,
      acceptsImages: model.input?.includes("image") === true,
      contextWindow: model.contextWindow ?? 128_000,
      maxTokens: model.maxTokens ?? 16_384,
    })),
  };
}

function agentConfigPath(file: "models.json" | "auth.json") {
  return path.join(process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), file);
}

function modelsPath() {
  return process.env.PI_WEB_MODELS_PATH || agentConfigPath("models.json");
}

function authPath() {
  return process.env.PI_WEB_AUTH_PATH || agentConfigPath("auth.json");
}

async function loadAuthJson(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(authPath(), "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new ProviderConfigValidationError("auth.json is too large.");
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) throw new ProviderConfigValidationError("auth.json cannot be parsed safely.");
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    if (error instanceof ProviderConfigValidationError) throw error;
    throw new ProviderConfigValidationError("auth.json cannot be parsed safely.");
  }
}

async function atomicWriteJson(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadModelsJson(): Promise<ModelsJson> {
  try {
    const content = await readFile(modelsPath(), "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new ProviderConfigValidationError("models.json is too large.");
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || !isRecord(parsed.providers)) throw new ProviderConfigValidationError("models.json must contain a providers object.");
    return { providers: parsed.providers as Record<string, StoredProvider> };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { providers: {} };
    if (error instanceof ProviderConfigValidationError) throw error;
    throw new ProviderConfigValidationError("models.json cannot be parsed safely.");
  }
}

function toSummary(id: string, provider: StoredProvider, hasStoredAuth = false): ProviderConfigSummary {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return {
    id,
    name: typeof provider.name === "string" ? provider.name : id,
    baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
    api: typeof provider.api === "string" ? provider.api : "openai-completions",
    authHeader: provider.authHeader !== false,
    hasApiKey: hasStoredAuth || (typeof provider.apiKey === "string" && provider.apiKey.length > 0),
    models: models.filter((model): model is StoredModel => isRecord(model) && typeof model.id === "string").map((model) => ({
      id: model.id,
      name: typeof model.name === "string" ? model.name : model.id,
      reasoning: model.reasoning === true,
      acceptsImages: model.input?.includes("image") === true,
      contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : 128_000,
      maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : 16_384,
    })),
  };
}

export async function listProviderConfigs(): Promise<ProviderConfigSummary[]> {
  const [config, auth] = await Promise.all([loadModelsJson(), loadAuthJson()]);
  return Object.entries(config.providers).map(([id, provider]) => toSummary(id, provider, Boolean(auth[id]))).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

async function atomicWrite(config: ModelsJson) {
  await atomicWriteJson(modelsPath(), config);
}

function storedProvider(config: ProviderConfig, current: StoredProvider | undefined): StoredProvider {
  const preserved = current ? { ...current } : {};
  delete preserved.apiKey;
  return {
    ...preserved,
    name: config.name,
    baseUrl: config.baseUrl,
    api: config.api,
    authHeader: config.authHeader,
    models: config.models.map((model) => ({
      id: model.id,
      name: model.name === model.id ? undefined : model.name,
      reasoning: model.reasoning,
      input: model.acceptsImages ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  };
}

async function mutate<T>(operation: (config: ModelsJson, auth: Record<string, unknown>) => Promise<T> | T): Promise<T> {
  const next = writeChain.then(async () => {
    const [config, auth] = await Promise.all([loadModelsJson(), loadAuthJson()]);
    const result = await operation(config, auth);
    if (Object.keys(config.providers).length > MAX_PROVIDERS) throw new ProviderConfigValidationError(`At most ${MAX_PROVIDERS} providers may be configured.`);
    await atomicWrite(config);
    await atomicWriteJson(authPath(), auth);
    return result;
  });
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

export async function saveProviderConfig(input: unknown): Promise<ProviderConfigSummary> {
  const config = parseProviderConfig(input);
  return mutate((modelsJson, auth) => {
    if (config.models.length === 0 && !Object.hasOwn(modelsJson.providers, config.id)) {
      throw new ProviderConfigValidationError("A new custom provider must include at least one model.");
    }
    modelsJson.providers[config.id] = storedProvider(config, modelsJson.providers[config.id]);
    if (config.apiKey) auth[config.id] = { type: "api_key", key: config.apiKey };
    return toSummary(config.id, modelsJson.providers[config.id], Boolean(auth[config.id]));
  });
}

export async function deleteProviderConfig(providerId: string): Promise<void> {
  if (!PROVIDER_ID_PATTERN.test(providerId) || providerId === "__proto__" || providerId === "constructor" || providerId === "prototype") {
    throw new ProviderConfigValidationError("Provider ID is invalid.");
  }
  await mutate((modelsJson, auth) => {
    if (!Object.hasOwn(modelsJson.providers, providerId)) throw new ProviderConfigValidationError("Provider configuration does not exist.");
    delete modelsJson.providers[providerId];
    delete auth[providerId];
  });
}
