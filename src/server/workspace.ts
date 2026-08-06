import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const SENSITIVE_FILE_NAMES = new Set([
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".ssh",
  ".aws",
  ".docker",
  ".gnupg",
  ".kube",
  "auth.json",
  "credentials",
  "credentials.json",
  "secrets",
  "secrets.json",
  "secret",
]);

const PRIVATE_KEY_NAMES = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx|ppk|jks|keystore)|.*\.(?:secret|token|credentials))$/i;
const WINDOWS_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function resolveWorkspace(): string {
  const configured = process.env.PI_WEB_WORKSPACE;
  const candidate = configured ?? process.cwd();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("PI_WEB_WORKSPACE must be an absolute path.");
  }

  let resolved: string;
  try {
    resolved = realpathSync(candidate);
  } catch {
    throw new Error("PI_WEB_WORKSPACE does not exist or cannot be resolved.");
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error("PI_WEB_WORKSPACE must point to a directory.");
  }
  return resolved;
}

/** Canonical, startup-fixed directory used for agent context and workspace tools. */
export const workspace = resolveWorkspace();

function isWithinWorkspace(candidate: string, root = workspace): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSensitiveComponent(component: string): boolean {
  const normalized = component.toLowerCase();
  return normalized === ".git"
    || normalized === ".pi"
    || normalized.startsWith(".")
    || SENSITIVE_FILE_NAMES.has(normalized)
    || PRIVATE_KEY_NAMES.test(component);
}

function assertSafeComponent(component: string): void {
  if (!component || component === "." || component === "..") {
    throw new Error("Workspace paths may not contain empty or dot components.");
  }
  if (component.endsWith(".") || component.endsWith(" ") || component.includes(":")) {
    throw new Error("Workspace paths may not contain Windows aliases or alternate streams.");
  }
  if (WINDOWS_DEVICE_NAMES.test(component)) {
    throw new Error("Workspace paths may not target Windows device names.");
  }
}

function assertCanonicalPathIsNotSensitive(candidate: string, root: string): void {
  const relative = path.relative(root, candidate);
  if (relative && isSensitiveWorkspacePath(relative)) {
    throw new Error("That workspace path is not available.");
  }
}

/** Returns true when a relative workspace path targets a credential or private key location. */
export function isSensitiveWorkspacePath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some(isSensitiveComponent);
}

/**
 * Reject non-relative paths before they reach platform path resolution. Both
 * separator styles are checked so Windows paths cannot be smuggled on POSIX.
 */
export function assertSafeWorkspaceRelativePath(relativePath: string): void {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0")) {
    throw new Error("Workspace paths must be non-empty relative paths.");
  }
  if (path.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || path.posix.isAbsolute(relativePath)
    || /^[a-z]:/i.test(relativePath)) {
    throw new Error("Workspace paths must be relative.");
  }

  const components = relativePath.split(/[\\/]+/);
  if (relativePath !== ".") components.forEach(assertSafeComponent);
  if (relativePath !== "." && isSensitiveWorkspacePath(relativePath)) {
    throw new Error("That workspace path is not available.");
  }
}

function assertExistingPathIsSafe(candidate: string, root: string): string {
  const status = lstatSync(candidate);
  if (status.isSymbolicLink()) {
    throw new Error("Symlinks, junctions, and reparse points are not available.");
  }
  const canonical = realpathSync(candidate);
  if (!isWithinWorkspace(canonical, root)) {
    throw new Error("Workspace path resolves outside the workspace.");
  }
  assertCanonicalPathIsNotSensitive(canonical, root);
  return canonical;
}

/**
 * Resolves an existing workspace item after verifying each existing component.
 * The returned path is canonical but must never be exposed outside the server.
 */
export function resolveExistingWorkspacePath(relativePath: string, root = workspace): string {
  assertSafeWorkspaceRelativePath(relativePath);
  const candidate = path.resolve(root, relativePath);
  if (!isWithinWorkspace(candidate, root)) throw new Error("Workspace path escapes the workspace.");

  let current = root;
  assertExistingPathIsSafe(current, root);
  for (const component of relativePath.split(/[\\/]+/)) {
    if (component === "." || component === "") continue;
    current = path.join(current, component);
    assertExistingPathIsSafe(current, root);
  }
  return current;
}

/**
 * Resolves a mutation target. Existing targets are canonicalized; new targets
 * require a safe, canonical existing parent directory.
 */
export function resolveWorkspaceMutationPath(relativePath: string, root = workspace): string {
  assertSafeWorkspaceRelativePath(relativePath);
  const candidate = path.resolve(root, relativePath);
  if (!isWithinWorkspace(candidate, root)) throw new Error("Workspace path escapes the workspace.");

  try {
    return resolveExistingWorkspacePath(relativePath, root);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }

  const parentRelative = path.dirname(relativePath);
  const parent = resolveExistingWorkspacePath(parentRelative === "." ? "." : parentRelative, root);
  if (!statSync(parent).isDirectory()) throw new Error("The parent path must be a directory.");
  return path.join(parent, path.basename(relativePath));
}

/** Converts a validated canonical workspace path into a safe display path. */
export function toWorkspaceRelativePath(absolutePath: string, root = workspace): string {
  const relative = path.relative(root, absolutePath);
  if (!isWithinWorkspace(absolutePath, root) || relative === "") return ".";
  return relative.split(path.sep).join("/");
}
