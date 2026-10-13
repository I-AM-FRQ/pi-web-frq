import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { workspace } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 本地文件资源：把模型输出里的本地路径（图片/文件）变成浏览器可直接显示或下载的资源。
 *
 * - path 为绝对路径时直接使用；为相对路径时按默认工作区解析
 * - 图片按真实类型返回（浏览器直接渲染），文本类返回可读文本，其余作为下载
 * - 本路由受与其它 API 相同的访问密钥保护（非本机访问需要登录）
 */

const MAX_BYTES = 32 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get("path");
  if (!rawPath || !rawPath.trim()) return errorResponse("invalid_path", "缺少文件路径。", 400);

  const target = isAbsolute(rawPath) ? rawPath : resolve(workspace, rawPath);
  try {
    const metadata = await stat(target);
    if (!metadata.isFile()) return errorResponse("not_a_file", "路径不是一个文件。", 400);
    if (metadata.size > MAX_BYTES) return errorResponse("too_large", "文件过大（上限 32 MiB）。", 413);

    const data = await readFile(target);
    const extension = extname(target).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    const isInline = contentType.startsWith("image/") || contentType.startsWith("text/") || contentType === "application/pdf";
    const filename = target.split(/[\\/]/).pop() ?? "file";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.byteLength),
        // 图片/文本可内联显示，其余触发下载（文件名保留原扩展名）
        "Content-Disposition": `${isInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch {
    return errorResponse("not_found", "文件不存在或无法读取。", 404);
  }
}
