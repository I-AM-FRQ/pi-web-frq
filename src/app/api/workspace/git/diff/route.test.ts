import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

describe("workspace Git diff route", () => {
  it("rejects an invalid diff mode before Git access", async () => {
    const response = await GET(request("http://127.0.0.1:30142/api/workspace/git/diff?path=README.md&mode=invalid", { host: "127.0.0.1:30142" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_git_diff_mode", message: "Git diff mode is invalid." },
    });
  });

  it("rejects an unsafe path before Git access", async () => {
    const response = await GET(request("http://127.0.0.1:30142/api/workspace/git/diff?path=..%2Foutside.txt&mode=staged", { host: "127.0.0.1:30142" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_workspace_path", message: "Workspace path is invalid or unavailable." },
    });
  });
});
