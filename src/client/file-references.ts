export type FileReference = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type MentionQuery = {
  query: string;
  start: number;
  end: number;
};

export type TextInsertion = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function normalizedLine(line: number | undefined) {
  return Number.isInteger(line) && line! > 0 ? line : undefined;
}

export function formatFileReference(path: string, startLine?: number, endLine?: number) {
  const relativePath = path.trim().replace(/\\/g, "/");
  if (!relativePath || /[\r\n{}]/.test(relativePath)) throw new Error("文件路径必须是有效的相对路径。");

  const start = normalizedLine(startLine);
  const end = normalizedLine(endLine);
  if (!start && end) throw new Error("行范围必须指定起始行。");
  if (start && end && end < start) throw new Error("结束行不能小于起始行。");

  if (!start) return `@{${relativePath}}`;
  return `@{${relativePath}}#L${start}${end && end !== start ? `-L${end}` : ""}`;
}

export function findMentionQuery(value: string, cursor: number): MentionQuery | null {
  const end = Math.max(0, Math.min(cursor, value.length));
  const marker = value.lastIndexOf("@", end - 1);
  if (marker < 0) return null;

  const query = value.slice(marker + 1, end);
  if (/[\s@{}]/.test(query)) return null;
  return { query, start: marker, end };
}

export function insertFileReference(value: string, cursor: number, reference: string): TextInsertion {
  const mention = findMentionQuery(value, cursor);
  const start = mention?.start ?? Math.max(0, Math.min(cursor, value.length));
  const end = Math.max(0, Math.min(cursor, value.length));
  const nextValue = `${value.slice(0, start)}${reference}${value.slice(end)}`;
  const nextCursor = start + reference.length;
  return { value: nextValue, selectionStart: nextCursor, selectionEnd: nextCursor };
}
