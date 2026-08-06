@echo off
chcp 65001 >nul
echo 正在停止 pi-web-frq 服务...

rem 精确匹配运行中且命令行包含 serve.cjs start 的 node 进程。
rem 注意：外层双引号包 -Command，内层字符串用单引号，避免 cmd 转义问题。
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.cjs*start*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ('已停止 PID ' + $_.ProcessId) }"

echo 完成。如果服务窗口仍在，可直接关闭它。
pause
