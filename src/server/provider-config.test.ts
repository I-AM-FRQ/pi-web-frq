import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-provider-config-"));
vi.stubEnv("PI_WEB_MODELS_PATH", path.join(directory, "models.json"));
vi.stubEnv("PI_WEB_AUTH_PATH", path.join(directory, "auth.json"));
const { ProviderConfigValidationError, deleteProviderConfig, listProviderConfigs, parseProviderConfig, saveProviderConfig } = await import("./provider-config");

const provider = {
  id: "local-test",
  name: "Local Test",
  baseUrl: "http://127.0.0.1:8080/v1",
  api: "openai-completions",
  apiKey: "secret-that-must-not-be-returned",
  authHeader: true,
  models: [{ id: "test-model", name: "Test Model", reasoning: true, acceptsImages: true, contextWindow: 128000, maxTokens: 16384 }],
};

beforeEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("provider configuration", () => {
  it("stores the model schema and keeps API keys out of configuration reads", async () => {
    const saved = await saveProviderConfig(provider);
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(provider.apiKey);
    await expect(listProviderConfigs()).resolves.toEqual([expect.objectContaining({ id: "local-test", hasApiKey: true })]);
    const modelsJson = await readFile(path.join(directory, "models.json"), "utf8");
    const authJson = await readFile(path.join(directory, "auth.json"), "utf8");
    expect(modelsJson).not.toContain(provider.apiKey);
    expect(authJson).toContain(provider.apiKey);
  });

  it("keeps an existing key when an edit omits apiKey", async () => {
    await saveProviderConfig(provider);
    await saveProviderConfig({ ...provider, name: "Renamed", apiKey: undefined });
    const authJson = await readFile(path.join(directory, "auth.json"), "utf8");
    expect(authJson).toContain(provider.apiKey);
  });

  it("removes provider structure and stored credentials together", async () => {
    await saveProviderConfig(provider);
    await deleteProviderConfig("local-test");
    await expect(listProviderConfigs()).resolves.toEqual([]);
    await expect(readFile(path.join(directory, "auth.json"), "utf8")).resolves.not.toContain(provider.apiKey);
  });

  it.each([
    { ...provider, id: "../outside" },
    { ...provider, baseUrl: "file:///secret" },
    { ...provider, api: "unsupported" },
  ])("rejects invalid provider input", (input) => {
    expect(() => parseProviderConfig(input)).toThrow(ProviderConfigValidationError);
  });

  it("requires a model when creating a new custom provider", async () => {
    await expect(saveProviderConfig({ ...provider, id: "empty-provider", models: [] })).rejects.toBeInstanceOf(ProviderConfigValidationError);
  });
});
