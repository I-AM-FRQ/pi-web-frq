import { describe, expect, it } from "vitest";
import { linkifyLocalPaths } from "./chat-markdown";

describe("linkifyLocalPaths", () => {
	it("Windows 本地图片路径转成内联图片", () => {
		const result = linkifyLocalPaths("截图如下 D:\\Program\\pics\\shot.png 请查看");
		expect(result).toContain("![shot.png](/api/local-file?path=");
		expect(result).toContain(encodeURIComponent("D:\\Program\\pics\\shot.png"));
	});

	it("Unix 本地图片路径转成内联图片", () => {
		const result = linkifyLocalPaths("见 /home/user/a/b.jpg");
		expect(result).toContain("![b.jpg](/api/local-file?path=");
	});

	it("本地文件路径转成可点击链接", () => {
		const result = linkifyLocalPaths("报告在 D:\\work\\report.pdf 里");
		expect(result).toContain("[report.pdf](/api/local-file?path=");
	});

	it("已有的 markdown 图片/链接不被改动", () => {
		const content = "![图](https://example.com/a.png) 与 [链接](https://example.com)";
		expect(linkifyLocalPaths(content)).toBe(content);
	});

	it("http(s) URL 里的路径不被误伤", () => {
		const result = linkifyLocalPaths("参考 https://example.com/assets/logo.png 这个地址");
		expect(result).not.toContain("/api/local-file");
		expect(result).toContain("https://example.com/assets/logo.png");
	});

	it("普通文本不受影响", () => {
		const content = "这是一个普通句子，包含 1、2、3 与 http://a.b 等。";
		expect(linkifyLocalPaths(content)).toBe(content);
	});

	it("同时处理图片与文件，且不重复包装 API 路径", () => {
		const result = linkifyLocalPaths("D:\\a\\pic.png 和 D:\\a\\doc.md");
		expect(result.match(/\/api\/local-file\?path=/g)).toHaveLength(2);
		expect(result).not.toContain("/api/local-file?path=%2Fapi%2F");
	});
});
