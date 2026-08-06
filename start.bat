@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo    pi-web-frq  one-click start
echo ============================================
echo.

rem ---- 1) check Node.js ----
node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 22+ first.
  pause
  exit /b 1
)

rem ---- 2) check dependencies ----
if not exist "node_modules" (
  echo [INSTALL] Installing dependencies (1-3 min)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

rem ---- 3) check production build ----
if not exist ".next\BUILD_ID" (
  echo [BUILD] Building production bundle (1-2 min)...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)

rem ---- 4) read port ----
set "PORT=30142"
for /f "usebackq delims=" %%p in (`node -e "try{var c=require('node:fs').readFileSync(process.env.USERPROFILE+'/.pi/agent/workbench/service.json','utf8');var p=JSON.parse(c).port;if(Number.isInteger(p)&&p>0)console.log(p);else console.log(30142)}catch(e){console.log(30142)}"`) do set "PORT=%%p"

rem ---- 5) start server ----
echo [START] Port %PORT% ...
start "pi-web-frq-server" cmd /k "chcp 936 >nul & title pi-web-frq server & node scripts\serve.cjs start"

rem ---- 6) wait ready and open browser ----
echo [WAIT] Starting...
set "READY="
for /l %%i in (1,1,60) do (
  >nul 2>&1 curl -s "http://127.0.0.1:%PORT%/api/health"
  if not errorlevel 1 (
    set "READY=1"
    goto :ready
  )
  timeout /t 1 /nobreak >nul
)
:ready
if "%READY%"=="1" (
  echo [OK] Server ready, opening browser...
  start "" "http://127.0.0.1:%PORT%"
) else (
  echo [WARN] Server not ready in 60s. Check the server window log.
)
echo.
echo Local:    http://127.0.0.1:%PORT%
echo LAN:      http://IP:%PORT%    (Tailscale: http://hostname:%PORT%)
echo Stop:     close "pi-web-frq server" window, or run stop.bat
echo.
pause
endlocal