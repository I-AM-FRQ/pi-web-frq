import { afterEach, describe, expect, it, vi } from "vitest";

const readServiceConfigMock = vi.fn();
vi.mock("@/server/service-config", () => ({
	readServiceConfig: () => readServiceConfigMock(),
}));
vi.mock("@/server/pi", () => ({
	getAvailableModels: vi.fn(async () => []),
	createToolFreeSession: vi.fn(),
}));

const { askDecisionModel } = await import("./decision");

afterEach(() => {
	readServiceConfigMock.mockReset();
});

describe("askDecisionModel", () => {
	it("未配置决策模型时返回 unset（调用方据此降级）", async () => {
		readServiceConfigMock.mockResolvedValue({ port: 30142, workspace: "C:/tmp", projectWorkspacesRoot: "C:/tmp" });
		const result = await askDecisionModel({ kind: "decision", question: "选 A 还是 B？" });
		expect(result).toEqual({ ok: false, reason: "unset" });
	});

	it("空问题直接失败，不触达模型", async () => {
		readServiceConfigMock.mockResolvedValue({ port: 30142, workspace: "C:/tmp", projectWorkspacesRoot: "C:/tmp", decisionModel: "deepseek:deepseek-v4-flash" });
		const result = await askDecisionModel({ kind: "supervision", question: "   " });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("failed");
	});

	it("配置的模型不在可用列表时返回 model_unavailable", async () => {
		readServiceConfigMock.mockResolvedValue({ port: 30142, workspace: "C:/tmp", projectWorkspacesRoot: "C:/tmp", decisionModel: "ghost:missing-model" });
		const result = await askDecisionModel({ kind: "decision", question: "选哪个？" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("model_unavailable");
			expect(result.detail).toBe("ghost:missing-model");
		}
	});
});
