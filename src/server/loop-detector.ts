/**
 * 模型重复输出检测器（熔断前的"软提醒"信号源）。
 *
 * 部分模型会陷入无意义重复：逐字重复、整段循环、单字连刷。
 * 本模块只负责识别并返回信号，由调用方决定动作（当前是注入 steer 提醒模型自行纠正，不中止任务）。
 */

export type LoopDetectorOptions = {
	/** 累积多少字符后才开始检测（避免短回复误判），默认 400 */
	minChars?: number;
	/** 检测窗口字符数，默认 800 */
	windowChars?: number;
	/** 窗口内同一片段允许出现的最大次数，默认 4 */
	maxRepeats?: number;
	/** 连续完全相同的增量上限，默认 12 */
	maxIdenticalDeltas?: number;
};

export type LoopSignal = {
	kind: "text" | "thinking";
	reason: string;
	sample: string;
};

type KindState = {
	text: string;
	lastDelta: string;
	identicalCount: number;
};

const KINDS = ["text", "thinking"] as const;

function sampleOf(value: string): string {
	return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

/** 末尾是否为周期 p 的重复（至少 repeats 个周期）。 */
function periodicTail(text: string, period: number, repeats: number): boolean {
	const need = period * repeats;
	if (text.length < need) return false;
	for (let i = text.length - 1; i >= text.length - need; i -= 1) {
		if (text[i] !== text[i - period]) return false;
	}
	return true;
}

/** 检测 1：末尾短模式（1-8 字符）连续重复（单字连刷、"ababab…"）。 */
function detectShortPatternRepeat(text: string): string | null {
	const tail = text.slice(-480);
	const minRepeatChars = 80;
	if (tail.length < minRepeatChars) return null;
	for (let period = 1; period <= 8; period += 1) {
		if (tail.length < period * 2) break;
		if (periodicTail(tail, period, Math.ceil(minRepeatChars / period))) {
			return sampleOf(tail.slice(-period * 4));
		}
	}
	return null;
}

/**
 * 检测 2：末尾长周期重复（≤120 字符的片段重复 ≥3 次，覆盖整段循环）。
 * 要求重复区域至少 60 字符，避免末尾 3 个相同字符这类正常文本被误判；短周期由检测 1 负责。
 */
function detectPeriodicTail(text: string): string | null {
	const maxPeriod = 120;
	const repeats = 3;
	const minRepeatChars = 60;
	const minPeriod = Math.ceil(minRepeatChars / repeats);
	for (let period = minPeriod; period <= Math.min(maxPeriod, Math.floor(text.length / repeats)); period += 1) {
		if (periodicTail(text, period, repeats)) {
			return sampleOf(text.slice(-period * repeats));
		}
	}
	return null;
}

/** 检测 3：窗口内同一片段（≥24 字符）出现 ≥ maxRepeats 次（间隔重复，如多条相似句子）。 */
function detectWindowRepeat(text: string, windowChars: number, maxRepeats: number): string | null {
	const window = text.slice(-windowChars);
	const probeLength = Math.min(48, Math.floor(window.length / maxRepeats));
	if (probeLength < 24) return null;
	const probe = window.slice(-probeLength);
	let count = 0;
	let index = window.indexOf(probe);
	while (index !== -1) {
		count += 1;
		if (count >= maxRepeats) return sampleOf(probe);
		index = window.indexOf(probe, index + probeLength);
	}
	return null;
}

export function createLoopDetector(options: LoopDetectorOptions = {}) {
	const minChars = options.minChars ?? 400;
	const windowChars = options.windowChars ?? 800;
	const maxRepeats = options.maxRepeats ?? 4;
	const maxIdenticalDeltas = options.maxIdenticalDeltas ?? 12;

	const state: Record<"text" | "thinking", KindState> = {
		text: { text: "", lastDelta: "", identicalCount: 0 },
		thinking: { text: "", lastDelta: "", identicalCount: 0 },
	};

	const reset = () => {
		for (const kind of KINDS) {
			state[kind].text = "";
			state[kind].lastDelta = "";
			state[kind].identicalCount = 0;
		}
	};

	const push = (kind: "text" | "thinking", delta: string): LoopSignal | null => {
		if (!delta) return null;
		const current = state[kind];
		current.text += delta;
		// 只保留窗口的两倍长度，避免长时间运行累积内存
		if (current.text.length > windowChars * 2) current.text = current.text.slice(-windowChars * 2);

		// 连续完全相同的增量（逐字重复）
		if (delta === current.lastDelta) current.identicalCount += 1;
		else {
			current.lastDelta = delta;
			current.identicalCount = 1;
		}
		if (current.text.length < minChars) return null;
		if (current.identicalCount >= maxIdenticalDeltas) {
			return { kind, reason: "连续输出完全相同的片段", sample: sampleOf(delta) };
		}

		const shortPattern = detectShortPatternRepeat(current.text);
		if (shortPattern) return { kind, reason: "字符或短语连续重复", sample: shortPattern };

		const periodic = detectPeriodicTail(current.text);
		if (periodic) return { kind, reason: "段落循环重复", sample: periodic };

		const windowRepeat = detectWindowRepeat(current.text, windowChars, maxRepeats);
		if (windowRepeat) return { kind, reason: "内容间隔重复", sample: windowRepeat };

		return null;
	};

	return { push, reset };
}

export type LoopDetector = ReturnType<typeof createLoopDetector>;
