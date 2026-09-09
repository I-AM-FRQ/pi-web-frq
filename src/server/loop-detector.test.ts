import { describe, expect, it } from "vitest";
import { createLoopDetector } from "./loop-detector";

/** 模拟模型逐字/逐块输出：把长文本按 size 切成增量依次喂入。 */
function feed(detector: ReturnType<typeof createLoopDetector>, kind: "text" | "thinking", text: string, size = 8) {
	let signal = null as ReturnType<typeof detector.push>;
	for (let i = 0; i < text.length; i += size) {
		signal = detector.push(kind, text.slice(i, i + size));
		if (signal) return signal;
	}
	return signal;
}

/** 生成不含重复模式的长文本（递增编号），用于验证不误判。 */
function uniqueText(chars: number): string {
	const parts: string[] = [];
	let length = 0;
	for (let i = 0; length < chars; i += 1) {
		const sentence = `第 ${i} 步：处理编号 ${i} 的数据，记录耗时 ${i * 7} 毫秒并写入结果表。`;
		parts.push(sentence);
		length += sentence.length;
	}
	return parts.join("");
}

const NORMAL_CHINESE = uniqueText(900);
const NORMAL_ENGLISH = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! ".repeat(3);
const NORMAL_CODE = [
	"```ts",
	"function add(a: number, b: number): number {",
	"\treturn a + b;",
	"}",
	"",
	"const list = [1, 2, 3].map((value) => ({ id: value, name: `item-${value}` }));",
	"console.log(list.length);",
	"```",
	"",
].join("\n").repeat(3);

describe("createLoopDetector", () => {
	it("正常中文叙述不误判", () => {
		const detector = createLoopDetector();
		expect(feed(detector, "text", NORMAL_CHINESE)).toBeNull();
	});

	it("正常英文叙述不误判", () => {
		const detector = createLoopDetector();
		expect(feed(detector, "text", NORMAL_ENGLISH)).toBeNull();
	});

	it("正常代码块不误判", () => {
		const detector = createLoopDetector();
		expect(feed(detector, "text", NORMAL_CODE)).toBeNull();
	});

	it("短文本不检测（低于 minChars 门槛）", () => {
		const detector = createLoopDetector({ minChars: 10_000 });
		expect(feed(detector, "text", "aaaa".repeat(100))).toBeNull();
	});

	it("连续完全相同的增量命中", () => {
		const detector = createLoopDetector({ minChars: 100 });
		let signal = null as ReturnType<typeof detector.push>;
		for (let i = 0; i < 30 && !signal; i += 1) signal = detector.push("text", "让我想想。");
		expect(signal?.reason).toMatch(/相同|重复/);
	});

	it("段落循环重复命中", () => {
		const detector = createLoopDetector({ minChars: 100 });
		const paragraph = "我需要先检查一下这个问题的根本原因，然后再决定下一步怎么做。";
		const signal = feed(detector, "text", paragraph.repeat(6), 12);
		expect(signal?.reason).toContain("段落循环");
	});

	it("单字连续重复命中", () => {
		const detector = createLoopDetector({ minChars: 100 });
		const signal = feed(detector, "text", "啊".repeat(200), 5);
		expect(signal?.reason).toMatch(/相同|重复/);
	});

	it("abab 模式连续重复命中", () => {
		const detector = createLoopDetector({ minChars: 100 });
		const signal = feed(detector, "text", "ab".repeat(100), 7);
		expect(signal?.reason).toMatch(/相同|重复/);
	});

	it("text 与 thinking 独立累积，交替不同内容不误判", () => {
		const detector = createLoopDetector({ minChars: 100 });
		let signal = null as ReturnType<typeof detector.push>;
		for (let i = 0; i < 12 && !signal; i += 1) {
			signal = detector.push("thinking", `思考第 ${i} 点：这里需要考虑输入边界与异常分支。`);
			if (!signal) signal = detector.push("text", `结论第 ${i} 条：按编号 ${i} 的顺序执行并验证。`);
		}
		expect(signal).toBeNull();
	});

	it("reset 后重新开始累积", () => {
		const detector = createLoopDetector({ minChars: 100 });
		feed(detector, "text", "啊".repeat(200), 5);
		detector.reset();
		expect(feed(detector, "text", uniqueText(500))).toBeNull();
	});

	it("空增量不触发", () => {
		const detector = createLoopDetector({ minChars: 1 });
		expect(detector.push("text", "")).toBeNull();
	});

	it("末尾少量相同字符不误判（标点收尾）", () => {
		const detector = createLoopDetector({ minChars: 100 });
		expect(feed(detector, "text", `${NORMAL_CHINESE}。。。`, 9)).toBeNull();
	});
});
