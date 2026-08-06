"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
// 服务启动包装器：读取 ~/.pi/agent/workbench/service.json 中保存的端口与默认工作区，
// 再以对应参数启动 next。配置在“全局设置 → 系统”中修改，保存后重启本脚本生效。
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG_PATH = process.env.PI_WEB_SERVICE_CONFIG || path.join(os.homedir(), ".pi", "agent", "workbench", "service.json");

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const port = Number(raw?.port);
    return {
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
      workspace: typeof raw?.workspace === "string" && raw.workspace.length > 0 ? raw.workspace : null,
      projectWorkspacesRoot: typeof raw?.projectWorkspacesRoot === "string" && raw.projectWorkspacesRoot.length > 0 ? raw.projectWorkspacesRoot : null,
    };
  } catch {
    return { port: null, workspace: null, projectWorkspacesRoot: null };
  }
}

const command = process.argv[2] ?? "dev";
if (command !== "dev" && command !== "start") {
  console.error(`Unknown command "${command}". Expected "dev" or "start".`);
  process.exit(1);
}

const config = readConfig();
const port = config.port ?? 30142;
const nextBin = require.resolve("next/dist/bin/next", { paths: [__dirname, process.cwd()] });
const child = spawn(process.execPath, [nextBin, command, "-H", "0.0.0.0", "-p", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    ...(config.workspace ? { PI_WEB_WORKSPACE: config.workspace } : {}),
    ...(config.projectWorkspacesRoot ? { PI_WEB_PROJECT_WORKSPACES_DIR: config.projectWorkspacesRoot } : {}),
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
