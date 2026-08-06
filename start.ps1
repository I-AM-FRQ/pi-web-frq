$ErrorActionPreference = 'Stop'

# ===== pi-web-frq 一键启动（PowerShell，服务隐藏后台运行）=====
$Root = $PSScriptRoot

# Node 路径（PATH 中查找）
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    throw 'Node.js not found. Please install Node.js 22+ (https://nodejs.org).'
}

# 端口：从 service.json 读取
$ConfigPath = Join-Path $env:USERPROFILE '.pi\agent\workbench\service.json'
$Port = 30142
try {
    $Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if ($Config.port -is [int] -and $Config.port -ge 1 -and $Config.port -le 65535) { $Port = [int]$Config.port }
} catch { }

$Url = "http://127.0.0.1:$Port"
Write-Output '===== pi-web-frq one-click start ====='
Write-Output "Root: $Root"

# 依赖
if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Output '[INSTALL] npm install (1-3 min)...'
    Push-Location $Root
    npm install --no-audit --no-fund
    $InstallCode = $LASTEXITCODE
    Pop-Location
    if ($InstallCode -ne 0) { throw 'npm install failed.' }
}

# 生产构建
if (-not (Test-Path -LiteralPath (Join-Path $Root '.next\BUILD_ID'))) {
    Write-Output '[BUILD] npm run build (1-2 min)...'
    Push-Location $Root
    npm run build
    $BuildCode = $LASTEXITCODE
    Pop-Location
    if ($BuildCode -ne 0) { throw 'Build failed.' }
}

# 已在运行？直接打开浏览器返回
$Existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($Existing) {
    Write-Output "[OK] server already running at $Url"
    Start-Process $Url | Out-Null
    exit 0
}

# 启动服务：隐藏窗口、后台运行（日志写 server.log）
Write-Output "[START] port $Port (background, logs: server.log)"
$LogFile = Join-Path $Root 'server.log'
Start-Process -FilePath $NodePath `
    -ArgumentList @((Join-Path $Root 'scripts\serve.cjs'), 'start') `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile | Out-Null

# 等待就绪并打开浏览器
$Ready = $false
for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $Ready = $true
        break
    } catch { }
}
if ($Ready) {
    Write-Output "[OK] server ready, opening browser..."
    Start-Process $Url | Out-Null
} else {
    Write-Output "[WARN] server not ready in 60s. See server.log"
}

Write-Output ''
Write-Output "Local:   $Url"
Write-Output "LAN:     http://IP:$Port   (Tailscale: http://hostname:$Port)"
Write-Output 'Stop:    run stop.bat'
