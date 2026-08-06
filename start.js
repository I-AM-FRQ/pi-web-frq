// pi-web-frq 一键启动（Node 实现，避免 cmd 批处理编码/解析问题）
const { spawn, exec } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = __dirname;
const configPath = path.join(process.env.USERPROFILE, ".pi", "agent", "workbench", "service.json");
const serverLog = path.join(root, "server.log");

function readPort() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const port = Number(parsed.port);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 30142;
  } catch {
    return 30142;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed with code ${code}`))));
  });
}

function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) resolve(false);
        else setTimeout(tick, 1000);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function openBrowser(url) {
  try {
    exec(`start "" "${url}"`);
  } catch {
    // 无桌面环境时忽略
  }
}

async function main() {
  const port = readPort();
  const url = `http://127.0.0.1:${port}`;
  console.log("===== pi-web-frq one-click start =====");

  // 服务已在运行？直接打开浏览器返回。
  if (await waitForHealth(url, 2500)) {
    console.log(`[OK] server is already running at ${url}`);
    openBrowser(url);
    return;
  }

  // 依赖
  if (!fs.existsSync(path.join(root, "node_modules"))) {
    console.log("[INSTALL] npm install (1-3 min)...");
    await run("npm", ["install", "--no-audit", "--no-fund"]);
  }

  // 生产构建
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("[BUILD] npm run build (1-2 min)...");
    await run("npm", ["run", "build"]);
  }

  // 启动服务：detached 独立进程组，关闭启动窗口后继续后台运行
  console.log(`[START] port ${port} (background, logs: server.log)`);
  let logFd = "ignore";
  try {
    logFd = fs.openSync(serverLog, "a");
  } catch {
    // server.log 被占用时仅放弃日志，不阻塞启动
  }
  const server = spawn(process.execPath, [path.join(root, "scripts", "serve.cjs"), "start"], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  });
  server.unref();

  // 等待就绪并打开浏览器
  console.log("[WAIT] starting...");
  const ready = await waitForHealth(url, 60_000);
  if (ready) {
    console.log(`[OK] server ready, opening browser...`);
    openBrowser(url);
  } else {
    console.log(`[WARN] server not ready in 60s. See ${serverLog}.`);
  }

  console.log("");
  console.log(`Local:   ${url}`);
  console.log(`LAN:     http://本机IP:${port}   (Tailscale: http://设备名:${port})`);
  console.log("Stop:    run stop.bat");
}

main().catch((error) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
});
