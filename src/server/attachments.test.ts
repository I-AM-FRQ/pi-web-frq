import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-web-attachments-"));
vi.stubEnv("PI_WEB_WORKSPACE", workspace);
const { AttachmentValidationError, downloadImageAttachment, storeImageAttachments } = await import("./attachments");

const png = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
const image = { type: "image" as const, mimeType: "image/png" as const, data: png };

afterEach(async () => {
  await rm(path.join(workspace, ".pi-web-attachments"), { recursive: true, force: true });
});

describe("image attachments", () => {
  it("stores and serves a signature-verified image", async () => {
    const [attachment] = await storeImageAttachments("safe-session", [image]);
    const downloaded = await downloadImageAttachment("safe-session", attachment.id);
    expect(downloaded.mimeType).toBe("image/png");
    expect(downloaded.data.toString("base64")).toBe(png);
  });

  it.each([
    [{ ...image, mimeType: "image/jpeg" as const }],
    [{ ...image, data: "not-base64" }],
    [{ ...image, data: "" }],
  ])("rejects invalid image payloads", async (...images) => {
    await expect(storeImageAttachments("safe-session", images)).rejects.toBeInstanceOf(AttachmentValidationError);
  });

  it("rejects unsafe session and attachment identifiers", async () => {
    await expect(storeImageAttachments("../unsafe", [image])).rejects.toBeInstanceOf(AttachmentValidationError);
    await expect(downloadImageAttachment("safe-session", "../attachment")).rejects.toBeInstanceOf(AttachmentValidationError);
  });
});
