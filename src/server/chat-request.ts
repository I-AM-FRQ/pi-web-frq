import type { ChatImage, ChatRequest, ThinkingLevel } from "../contracts";
import { SESSION_ENTRY_ID_PATTERN } from "./session-fork";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class ChatRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRequestValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyHasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseChatRequest(value: unknown): ChatRequest {
  if (!isPlainObject(value) || !onlyHasKeys(value, ["prompt", "images", "sessionId", "branchFromEntryId", "model", "thinkingLevel", "resources", "projectId", "autoRetry"])) {
    throw new ChatRequestValidationError("Request body must be a ChatRequest object.");
  }
  if (!hasOwn(value, "prompt") || typeof value.prompt !== "string" || value.prompt.trim().length === 0 || value.prompt.length > 12_000) {
    throw new ChatRequestValidationError("prompt must be non-empty and at most 12000 characters.");
  }

  let images: ChatImage[] | undefined;
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > 4 || value.images.some((image) => !isPlainObject(image)
      || !onlyHasKeys(image, ["type", "data", "mimeType"])
      || image.type !== "image"
      || typeof image.data !== "string"
      || image.data.length === 0
      || image.data.length > 7_000_000
      || (image.mimeType !== "image/jpeg" && image.mimeType !== "image/png" && image.mimeType !== "image/webp"))) {
      throw new ChatRequestValidationError("images must contain at most 4 PNG, JPEG, or WebP images.");
    }
    images = value.images as ChatImage[];
  }

  let sessionId: string | undefined;
  if (value.sessionId !== undefined) {
    if (typeof value.sessionId !== "string" || !SESSION_ID_PATTERN.test(value.sessionId)) {
      throw new ChatRequestValidationError("sessionId must be a short, safe identifier.");
    }
    sessionId = value.sessionId;
  }

  let branchFromEntryId: string | undefined;
  if (value.branchFromEntryId !== undefined) {
    if (typeof value.branchFromEntryId !== "string" || !SESSION_ENTRY_ID_PATTERN.test(value.branchFromEntryId)) {
      throw new ChatRequestValidationError("branchFromEntryId must be an 8-character session entry identifier.");
    }
    if (!sessionId) throw new ChatRequestValidationError("branchFromEntryId requires sessionId.");
    branchFromEntryId = value.branchFromEntryId;
  }

  let model: ChatRequest["model"];
  if (value.model !== undefined) {
    if (!isPlainObject(value.model) || !onlyHasKeys(value.model, ["provider", "id"]) ||
      !hasOwn(value.model, "provider") || typeof value.model.provider !== "string" || value.model.provider.length === 0 ||
      !hasOwn(value.model, "id") || typeof value.model.id !== "string" || value.model.id.length === 0) {
      throw new ChatRequestValidationError("model must contain non-empty string provider and id fields.");
    }
    model = { provider: value.model.provider, id: value.model.id };
  }
  if (value.thinkingLevel !== undefined &&
    (typeof value.thinkingLevel !== "string" || !THINKING_LEVELS.has(value.thinkingLevel as ThinkingLevel))) {
    throw new ChatRequestValidationError("thinkingLevel is invalid.");
  }
  let resources: ChatRequest["resources"];
  if (value.resources !== undefined) {
    if (!isPlainObject(value.resources) || !onlyHasKeys(value.resources, ["skills", "plugins"]) || !Array.isArray(value.resources.skills) || !Array.isArray(value.resources.plugins)
      || value.resources.skills.length > 100 || value.resources.plugins.length > 100
      || value.resources.skills.some((item) => typeof item !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item))
      || value.resources.plugins.some((item) => typeof item !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item))) {
      throw new ChatRequestValidationError("resources must contain safe skill and plugin name arrays.");
    }
    resources = { skills: [...new Set(value.resources.skills)], plugins: [...new Set(value.resources.plugins)] };
  }
  let projectId: string | undefined;
  if (value.projectId !== undefined) {
    if (typeof value.projectId !== "string" || !/^project-[a-z0-9-]{8,80}$/.test(value.projectId)) {
      throw new ChatRequestValidationError("projectId is invalid.");
    }
    projectId = value.projectId;
  }
  let autoRetry: boolean | undefined;
  if (value.autoRetry !== undefined) {
    if (typeof value.autoRetry !== "boolean") throw new ChatRequestValidationError("autoRetry must be a boolean.");
    autoRetry = value.autoRetry;
  }
  return { prompt: value.prompt, images, sessionId, branchFromEntryId, model, thinkingLevel: value.thinkingLevel as ThinkingLevel | undefined, resources, projectId, autoRetry };
}
