import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandHomePath, parseServicePort, parseServiceProjectRoot, parseServiceWorkspace } from "./service-config";

describe("parseServicePort", () => {
  it.each(["30142", "1", "65535", 8080, 3000])("accepts a valid port %j", (value) => {
    const port = parseServicePort(value);
    expect(Number.isInteger(port) && port >= 1 && port <= 65535).toBe(true);
  });

  it.each(["0", "65536", "abc", "", "  ", "30 142", "1.5", -1])("rejects an invalid port %j", (value) => {
    expect(() => parseServicePort(value)).toThrow("端口必须是 1-65535 之间的整数。");
  });
});

describe("parseServiceWorkspace", () => {
  it("accepts an absolute path", () => {
    expect(parseServiceWorkspace("D:\\Program\\agent\\pi\\pi-web-ui")).toBe("D:\\Program\\agent\\pi\\pi-web-ui");
    expect(isAbsolute(parseServiceWorkspace("/home/user/work"))).toBe(true);
  });

  it("rejects empty or relative paths", () => {
    expect(() => parseServiceWorkspace("")).toThrow("默认工作区必须是绝对路径。");
    expect(() => parseServiceWorkspace("relative/path")).toThrow("默认工作区必须是绝对路径。");
    expect(() => parseServiceWorkspace("   ")).toThrow("默认工作区必须是绝对路径。");
    expect(() => parseServiceWorkspace(42)).toThrow("默认工作区必须是绝对路径。");
  });

  it("expands a leading ~ to the user home directory", () => {
    expect(expandHomePath("~")).toBe(homedir());
    expect(expandHomePath("~/Documents/Pi")).toBe(join(homedir(), "Documents", "Pi"));
    expect(expandHomePath("~\\Documents\\Pi")).toBe(join(homedir(), "Documents", "Pi"));
    expect(parseServiceWorkspace("~/Documents/Pi")).toBe(join(homedir(), "Documents", "Pi"));
    expect(parseServiceProjectRoot("~/Documents/Pi")).toBe(join(homedir(), "Documents", "Pi"));
  });
});

describe("parseServiceProjectRoot", () => {
  it("accepts an absolute path", () => {
    expect(parseServiceProjectRoot("C:\\Users\\FAN\\Documents\\Pi")).toBe("C:\\Users\\FAN\\Documents\\Pi");
    expect(isAbsolute(parseServiceProjectRoot("/data/projects"))).toBe(true);
  });

  it("rejects empty or relative paths", () => {
    expect(() => parseServiceProjectRoot("")).toThrow("项目默认保存位置必须是绝对路径。");
    expect(() => parseServiceProjectRoot("projects")).toThrow("项目默认保存位置必须是绝对路径。");
    expect(() => parseServiceProjectRoot("   ")).toThrow("项目默认保存位置必须是绝对路径。");
    expect(() => parseServiceProjectRoot(123)).toThrow("项目默认保存位置必须是绝对路径。");
  });
});
