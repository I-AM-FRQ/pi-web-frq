// pi-web-frq 停止服务（按命令行匹配 serve.cjs start 的 node 进程）
const { execSync } = require("node:child_process");

const command =
  'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*serve.cjs*start*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output (\'Stopped \' + $_.ProcessId) }"';

try {
  const output = execSync(command, { encoding: "utf8", windowsHide: true }).trim();
  console.log(output || "No running service found.");
} catch (error) {
  const message = error instanceof Error ? error.stdout?.toString?.() || error.message : String(error);
  console.log(message.trim() || "No running service found.");
}
