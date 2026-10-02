import { describe, expect, it } from "vitest";
import { pendingQueuePreview } from "./conversation-view";

describe("pendingQueuePreview", () => {
	it("多行内容压成单行（排队条目默认一行显示）", () => {
		const preview = pendingQueuePreview("第一行\n第二行\n\n第三行");
		expect(preview).toBe("第一行 第二行 第三行");
		expect(preview).not.toContain("\n");
	});

	it("子代理唤醒消息中的逐字换行被压平", () => {
		const wake = "[后台任务自动唤醒] 任务结果：\n<result>\nt\ne\ns\nt\n</result>\n请检查结果并继续。";
		const preview = pendingQueuePreview(wake);
		expect(preview).not.toContain("\n");
		expect(preview).toContain("t e s t");
	});

	it("图片 markdown 转为 [图片] 标记", () => {
		const preview = pendingQueuePreview("看看这张图\n![上传图片 1](/api/attachments/a/b)\n还有文字");
		expect(preview).toBe("看看这张图 [图片] 还有文字");
	});

	it("空内容与纯空白返回空串", () => {
		expect(pendingQueuePreview("")).toBe("");
		expect(pendingQueuePreview("  \n\n  ")).toBe("");
	});

	it("制表符与多空格归一为单个空格", () => {
		expect(pendingQueuePreview("a\t\tb    c")).toBe("a b c");
	});
});
