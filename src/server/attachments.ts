import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { workspace } from "@/server/workspace";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTACHMENT_ROOT = path.join(workspace, ".pi-web-attachments");
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AttachmentMetadata = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type ImageAttachment = {
  id: string;
  url: string;
};

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

function attachmentDirectory(sessionId: string, root = ATTACHMENT_ROOT) {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new AttachmentValidationError("Invalid attachment session.");
  return path.join(root, sessionId);
}

function attachmentId(value: string) {
  if (!ATTACHMENT_ID_PATTERN.test(value)) throw new AttachmentValidationError("Invalid image attachment.");
  return value;
}

function paths(sessionId: string, id: string, root?: string) {
  const directory = attachmentDirectory(sessionId, root);
  const attachment = attachmentId(id);
  return { directory, metadata: path.join(directory, `${attachment}.json`), data: path.join(directory, `${attachment}.bin`) };
}

function supportedMimeType(data: Uint8Array): AttachmentMetadata["mimeType"] | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  return undefined;
}

function decodeImage(image: ImageContent): { data: Buffer; mimeType: AttachmentMetadata["mimeType"] } {
  if (!IMAGE_MIME_TYPES.has(image.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length === 0) {
    throw new AttachmentValidationError("Only PNG, JPEG, and WebP images are accepted.");
  }
  const data = Buffer.from(image.data, "base64");
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES || data.toString("base64") !== image.data) {
    throw new AttachmentValidationError("Each image must be valid and at most 5 MiB.");
  }
  const detectedMimeType = supportedMimeType(data);
  if (detectedMimeType !== image.mimeType) throw new AttachmentValidationError("Image content does not match its declared type.");
  return { data, mimeType: detectedMimeType };
}

function validMetadata(value: unknown): value is AttachmentMetadata {
  return typeof value === "object" && value !== null && "mimeType" in value && IMAGE_MIME_TYPES.has(value.mimeType as string);
}

async function readAttachment(sessionId: string, id: string, root?: string) {
  const filePaths = paths(sessionId, id, root);
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readFile(filePaths.metadata, "utf8")) as unknown;
  } catch {
    throw new AttachmentValidationError("Image attachment is unavailable.");
  }
  if (!validMetadata(metadata)) throw new AttachmentValidationError("Image attachment is unavailable.");

  let data: Buffer;
  try {
    data = await readFile(filePaths.data);
  } catch {
    throw new AttachmentValidationError("Image attachment is unavailable.");
  }
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES || supportedMimeType(data) !== metadata.mimeType) {
    throw new AttachmentValidationError("Image attachment is unavailable.");
  }
  return { data, mimeType: metadata.mimeType };
}

export async function storeImageAttachments(sessionId: string, images: ImageContent[], root = ATTACHMENT_ROOT): Promise<ImageAttachment[]> {
  if (images.length === 0 || images.length > MAX_IMAGES) {
    throw new AttachmentValidationError(`Upload between 1 and ${MAX_IMAGES} images.`);
  }
  const directory = attachmentDirectory(sessionId, root);
  await mkdir(directory, { recursive: true });
  const attachments: ImageAttachment[] = [];

  try {
    for (const image of images) {
      const decoded = decodeImage(image);
      const id = randomUUID();
      const filePaths = paths(sessionId, id, root);
      await writeFile(filePaths.data, decoded.data, { flag: "wx" });
      try {
        await writeFile(filePaths.metadata, JSON.stringify({ mimeType: decoded.mimeType }), { encoding: "utf8", flag: "wx" });
      } catch (error) {
        await rm(filePaths.data, { force: true });
        throw error;
      }
      attachments.push({ id, url: `/api/attachments/${sessionId}/${id}` });
    }
    return attachments;
  } catch (error) {
    await Promise.all(attachments.map((attachment) => {
      const filePaths = paths(sessionId, attachment.id, root);
      return Promise.all([rm(filePaths.data, { force: true }), rm(filePaths.metadata, { force: true })]);
    }));
    throw error;
  }
}

export async function loadImageAttachments(sessionId: string, attachmentIds: string[], root?: string): Promise<ImageContent[]> {
  if (attachmentIds.length > MAX_IMAGES || new Set(attachmentIds).size !== attachmentIds.length) {
    throw new AttachmentValidationError(`At most ${MAX_IMAGES} distinct images may be attached.`);
  }
  return Promise.all(attachmentIds.map(async (id) => {
    const attachment = await readAttachment(sessionId, id, root);
    return { type: "image", data: attachment.data.toString("base64"), mimeType: attachment.mimeType };
  }));
}

export async function downloadImageAttachment(sessionId: string, id: string, root?: string) {
  return readAttachment(sessionId, id, root);
}

export async function deleteSessionAttachments(sessionId: string, root = ATTACHMENT_ROOT): Promise<void> {
  await rm(attachmentDirectory(sessionId, root), { recursive: true, force: true });
}
