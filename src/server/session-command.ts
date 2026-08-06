export const SESSION_COMMAND_NAMES = ["compact", "copy", "name", "reload", "session"] as const;

export type SessionCommandName = (typeof SESSION_COMMAND_NAMES)[number];

export type SessionCommandRequest = {
  command: SessionCommandName;
  argument: string;
};

export class SessionCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCommandValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseSessionCommandRequest(value: unknown): SessionCommandRequest {
  if (!isPlainObject(value) || Object.keys(value).some((key) => key !== "command" && key !== "argument") || typeof value.command !== "string") {
    throw new SessionCommandValidationError("Request body must contain a command.");
  }
  if (!SESSION_COMMAND_NAMES.includes(value.command as SessionCommandName)) {
    throw new SessionCommandValidationError("The requested command is unavailable.");
  }
  if (value.argument !== undefined && typeof value.argument !== "string") {
    throw new SessionCommandValidationError("Command argument must be text.");
  }
  const argument = (value.argument ?? "").trim();
  if (argument.length > 2_000 || /[\u0000-\u001f\u007f]/.test(argument.replace(/[\n\r\t]/g, ""))) {
    throw new SessionCommandValidationError("Command argument is invalid.");
  }
  if (value.command === "name" && (!argument || argument.length > 120)) {
    throw new SessionCommandValidationError("/name requires a session name of up to 120 characters.");
  }
  if ((value.command === "copy" || value.command === "reload" || value.command === "session") && argument) {
    throw new SessionCommandValidationError(`/${value.command} does not accept an argument.`);
  }
  return { command: value.command as SessionCommandName, argument };
}
