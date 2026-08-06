import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as workspaceGet } from "./workspace/route";
import { GET as workspaceFileGet } from "./workspace/file/route";

function request(url: string) {
  return new NextRequest(url);
}

describe("API input validation", () => {
  it("rejects an unsafe workspace directory path", async () => {
    const response = await workspaceGet(request("http://example.test/api/workspace?path=..%2Foutside"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_workspace_path", message: "Workspace path is invalid or unavailable." },
    });
  });

  it("rejects an unsafe workspace file path", async () => {
    const response = await workspaceFileGet(request("http://example.test/api/workspace/file?path=.env.local"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_workspace_path", message: "Workspace path is invalid or unavailable." },
    });
  });
});
