"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
// 服务启动包装器：读取 ~/.pi/agent/workbench/service.json 中保存的端口与默认工作区，
// 再以对应参数启动 next。配置在“全局设置 → 系统”中修改，保存后重启本脚本生效。
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG_PATH = process.env.PI_WEB_SERVICE_CONFIG || path.join(os.homedir(), ".pi", "agent", "workbench", "service.json");
const DEFAULT_WORKSPACE = path.join(os.homedir(), "Documents", "Pi", "Default");
const DEFAULT_PROJECT_WORKSPACES_ROOT = path.join(os.homedir(), "Documents", "Pi");

function ensureAccessKey(configPath = CONFIG_PATH) {
  let raw = {};
  let source = "";
  try {
    source = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
  } catch {
    // A missing or malformed configuration is replaced with a minimal valid object.
  }
  if (typeof raw.accessKey === "string" && raw.accessKey.length > 0) return raw.accessKey;

  const accessKey = randomBytes(16).toString("hex");
  const indent = /^([ \t]+)\"/m.exec(source)?.[1] ?? "  ";
  const ending = source.endsWith("\r\n") ? "\r\n" : "\n";
  const temporary = `${configPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ ...raw, accessKey }, null, indent)}${ending}`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, configPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return accessKey;
}

function readConfig(configPath = CONFIG_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const port = Number(raw?.port);
    return {
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
      workspace: typeof raw?.workspace === "string" && raw.workspace.trim().length > 0 ? raw.workspace.trim() : null,
      projectWorkspacesRoot: typeof raw?.projectWorkspacesRoot === "string" && raw.projectWorkspacesRoot.trim().length > 0 ? raw.projectWorkspacesRoot.trim() : null,
    };
  } catch {
    return { port: null, workspace: null, projectWorkspacesRoot: null };
  }
}

/**
 * 由启动器显式注入无项目工作区，避免无 service.json 时回退到应用源码 cwd。
 * 默认固定为 ~/Documents/Pi/Default；只有用户在 service.json（全局设置）中显式指定时才覆盖。
 */
function createServerEnvironment(config, parentEnv = process.env) {
  const port = config.port ?? 30142;
  const workspace = config.workspace ?? DEFAULT_WORKSPACE;
  const projectWorkspacesRoot = config.projectWorkspacesRoot ?? parentEnv.PI_WEB_PROJECT_WORKSPACES_DIR ?? DEFAULT_PROJECT_WORKSPACES_ROOT;
  return {
    ...parentEnv,
    PORT: String(port),
    PI_WEB_WORKSPACE: workspace,
    PI_WEB_PROJECT_WORKSPACES_DIR: projectWorkspacesRoot,
    PI_FRQ_WAKE_URL: `http://127.0.0.1:${port}/api/frq/wake`,
    PI_FRQ_WAKE_TOKEN: parentEnv.PI_FRQ_WAKE_TOKEN || require("node:crypto").randomBytes(32).toString("hex"),
  };
}

function main() {
  const command = process.argv[2] ?? "dev";
  if (command !== "dev" && command !== "start") {
    console.error(`Unknown command "${command}". Expected "dev" or "start".`);
    process.exit(1);
  }

  ensureAccessKey();
  const config = readConfig();
  const environment = createServerEnvironment(config);
  const port = Number(environment.PORT);
  const nextBin = require.resolve("next/dist/bin/next", { paths: [__dirname, process.cwd()] });
  const child = spawn(process.execPath, [nextBin, command, "-H", "0.0.0.0", "-p", String(port)], {
    stdio: "inherit",
    env: environment,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

if (require.main === module) main();

module.exports = { DEFAULT_PROJECT_WORKSPACES_ROOT, DEFAULT_WORKSPACE, createServerEnvironment, ensureAccessKey, readConfig };
