export class SessionNameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNameValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseSessionNameRequest(value: unknown): string {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.name !== "string") {
    throw new SessionNameValidationError("Request body must contain a session name.");
  }
  const name = value.name.trim();
  if (name.length === 0 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new SessionNameValidationError("Session name must be 1 to 120 printable characters.");
  }
  return name;
}
