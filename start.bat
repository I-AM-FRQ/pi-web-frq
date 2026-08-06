@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo    pi-web-frq  一键启动
echo ============================================
echo.

rem ---- 1) 检查 Node.js ----
node --version >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 22 或更高版本。
  echo         下载: https://nodejs.org/
  pause
  exit /b 1
)

rem ---- 2) 检查依赖 ----
if not exist "node_modules" (
  echo [安装] 首次运行需要安装依赖（约 1-3 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

rem ---- 3) 检查生产构建 ----
if not exist ".next\BUILD_ID" (
  echo [构建] 首次运行需要生产构建（约 1-2 分钟）...
  call npm run build
  if errorlevel 1 (
    echo [错误] 构建失败，请查看上方日志。
    pause
    exit /b 1
  )
)

rem ---- 4) 读取端口 ----
set "PORT=30142"
for /f "delims=" %%p in ('node -e "try{var c=require('node:fs').readFileSync(process.env.USERPROFILE+'/.pi/agent/workbench/service.json','utf8');var p=JSON.parse(c).port;if(Number.isInteger(p)&&p>0)console.log(p);else console.log(30142)}catch(e){console.log(30142)}"') do set "PORT=%%p"

rem ---- 5) 启动服务（独立窗口，关窗即停）----
echo [启动] 服务端口 %PORT% ，正在启动...
start "pi-web-frq-server" cmd /k "chcp 65001 >nul & title pi-web-frq 服务（关闭本窗口即停止） & node scripts\serve.cjs start"

rem ---- 6) 等待服务就绪并打开浏览器 ----
echo [等待] 服务启动中...
set "READY="
for /l %%i in (1,1,60) do (
  >nul 2>&1 curl -s "http://127.0.0.1:%PORT%/api/health"
  if not errorlevel 1 set "READY=1" & goto :ready
  timeout /t 1 /nobreak >nul
)
:ready
if "%READY%"=="1" (
  echo [完成] 服务已就绪，正在打开浏览器...
  start "" "http://127.0.0.1:%PORT%"
) else (
  echo [警告] 服务未在 60 秒内就绪，请检查服务窗口日志。
)
echo.
echo 服务地址: http://127.0.0.1:%PORT%
echo 局域网访问: http://本机IP:%PORT%   (Tailscale: http://设备名:%PORT%)
echo 停止服务: 关闭 "pi-web-frq 服务" 窗口，或运行 stop.bat
echo.
pause
endlocal
