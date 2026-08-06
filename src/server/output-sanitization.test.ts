import { describe, expect, it } from "vitest";
import { redactLocalPaths } from "./output-sanitization";

const root = "D:\\Program\\agent\\pi\\pi-web-ui";

describe("redactLocalPaths", () => {
  it("preserves workspace variants unchanged", () => {
    expect(redactLocalPaths("D:\\Program\\agent\\pi\\pi-web-ui\\src\\app.ts", root)).toBe("D:\\Program\\agent\\pi\\pi-web-ui\\src\\app.ts");
    expect(redactLocalPaths("d:/program/agent/pi/pi-web-ui/src/app.ts", root)).toBe("d:/program/agent/pi/pi-web-ui/src/app.ts");
  });

  it("preserves absolute paths, relative paths, and URLs", () => {
    const value = "C:\\Users\\FAN\\secret.txt /home/fan/.ssh/id_rsa \\\\server\\share\\file file:///C:/private.txt src/app.ts https://example.test/a";
    expect(redactLocalPaths(value, root)).toBe(value);
  });
});
