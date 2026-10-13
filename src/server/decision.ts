import { createToolFreeSession, getAvailableModels } from "@/server/pi";
import { readServiceConfig } from "@/server/service-config";
import { workspace } from "@/server/workspace";
import { assistantVisibleText } from "@/server/session-events";

/**
 * 决策/监督模型。
 *
 * 用途：
 * - 岔路决策（kind="decision"）：执行端模型需要外部拍板时，由决策模型给出明确决定。
 * - 跑偏监督（kind="supervision"）：检测到异常（重复输出、原地打转、连续失败）时，让决策模型判断是否跑偏并给出纠正指令。
 *
 * 约束：决策模型使用**内存会话 + 无工具**，只做判断，不能读写文件或执行命令。
 */

export type DecisionKind = "decision" | "supervision";

export type DecisionResult =
	| { ok: true; model: string; decision: string }
	| { ok: false; reason: "unset" | "model_unavailable" | "timeout" | "failed"; detail?: string };

const DECISION_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_CHARS = 6_000;

function decisionPrompt(input: { kind: DecisionKind; question: string; context?: string }): string {
	const context = (input.context ?? "").slice(0, MAX_CONTEXT_CHARS);
	if (input.kind === "supervision") {
		return [
			"你是本工作台的监督模型。执行端模型可能正在跑偏（重复输出、原地打转或偏离目标）。",
			"",
			"执行端的任务/目标：",
			input.question,
			context ? `\n最近的输出片段：\n${context}` : "",
			"",
			"请按以下格式回答（不要有多余内容）：",
			"判断：跑偏 / 未跑偏（附一句话理由）",
			"指令：若跑偏，给出一条给执行端的具体纠正指令（可直接执行，不超过 150 字）；若未跑偏，写“继续”",
		].filter(Boolean).join("\n");
	}
	return [
		"你是本工作台的决策模型。执行端模型遇到需要外部判断的岔路口，请做出明确决定。",
		"",
		"需要决策的问题：",
		input.question,
		context ? `\n背景信息：\n${context}` : "",
		"",
		"要求：",
		"- 直接给出决定与简要理由（合计不超过 200 字）",
		"- 决定要具体、可执行（执行端会照此继续）",
		"- 信息不足时，明确指出缺什么，并给出当前最稳妥的选择",
	].filter(Boolean).join("\n");
}

/** 询问决策模型。未配置决策模型时返回 ok:false + reason:"unset"（调用方自行决定降级行为）。 */
export async function askDecisionModel(input: { kind: DecisionKind; question: string; context?: string }): Promise<DecisionResult> {
	if (!input.question.trim()) return { ok: false, reason: "failed", detail: "决策问题不能为空。" };

	let configured: string | undefined;
	try {
		configured = (await readServiceConfig()).decisionModel;
	} catch (error) {
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	}
	if (!configured) return { ok: false, reason: "unset" };

	let models;
	try {
		models = await getAvailableModels();
	} catch (error) {
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	}
	const model = models.find((candidate) => `${candidate.provider}:${candidate.id}` === configured);
	if (!model) return { ok: false, reason: "model_unavailable", detail: configured };

	let session: Awaited<ReturnType<typeof createToolFreeSession>>["session"] | undefined;
	let text = "";
	let disposeServices: (() => void) | undefined;
	try {
		const created = await createToolFreeSession(model, "off", workspace);
		session = created.session;
		disposeServices = () => {
			try {
				created.session.dispose();
			} catch {
				// ignore
			}
		};
		session.subscribe((event) => {
			if (event.type === "message_update" && event.message.role === "assistant") {
				text = assistantVisibleText(event.message.content);
			}
		});
		let timedOut = false;
		await Promise.race([
			session.prompt(decisionPrompt(input)),
			new Promise<void>((resolve) => {
				setTimeout(() => { timedOut = true; resolve(); }, DECISION_TIMEOUT_MS);
			}),
		]);
		if (timedOut && !text.trim()) return { ok: false, reason: "timeout" };
		const decision = text.trim();
		if (!decision) return { ok: false, reason: "failed", detail: "决策模型没有返回内容。" };
		return { ok: true, model: configured, decision };
	} catch (error) {
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	} finally {
		disposeServices?.();
	}
}
