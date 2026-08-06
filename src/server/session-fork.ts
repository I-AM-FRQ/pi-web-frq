export const SESSION_ENTRY_ID_PATTERN = /^[a-f0-9]{8}$/i;

export class SessionForkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionForkValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseSessionForkRequest(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, "entryId") || Object.keys(value).length !== 1) {
    throw new SessionForkValidationError("Request body must contain only an entryId.");
  }
  if (typeof value.entryId !== "string" || !SESSION_ENTRY_ID_PATTERN.test(value.entryId)) {
    throw new SessionForkValidationError("entryId must be an 8-character session entry identifier.");
  }
  return value.entryId;
}
