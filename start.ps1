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

# 生产构建：缺失，或源码/配置/依赖比构建产物新时重建，避免更新后继续使用旧 .next。
$BuildIdPath = Join-Path $Root '.next\BUILD_ID'
$NeedsBuild = -not (Test-Path -LiteralPath $BuildIdPath)
if (-not $NeedsBuild) {
    $BuildTime = (Get-Item -LiteralPath $BuildIdPath).LastWriteTimeUtc
    $BuildInputs = @(
        (Join-Path $Root 'src'),
        (Join-Path $Root 'public'),
        (Join-Path $Root 'package.json'),
        (Join-Path $Root 'package-lock.json'),
        (Join-Path $Root 'next.config.ts'),
        (Join-Path $Root 'tsconfig.json')
    )
    foreach ($InputPath in $BuildInputs) {
        if (-not (Test-Path -LiteralPath $InputPath)) { continue }
        $NewerInput = if ((Get-Item -LiteralPath $InputPath).PSIsContainer) {
            Get-ChildItem -LiteralPath $InputPath -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $BuildTime } | Select-Object -First 1
        } elseif ((Get-Item -LiteralPath $InputPath).LastWriteTimeUtc -gt $BuildTime) {
            Get-Item -LiteralPath $InputPath
        }
        if ($NewerInput) {
            $NeedsBuild = $true
            Write-Output "[BUILD] source changed: $($NewerInput.FullName)"
            break
        }
    }
}
if ($NeedsBuild) {
    # 旧服务仍在时，先停止它；否则即使构建完成，端口仍会指向旧 .next。
    $Existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($Existing) {
        $ServiceProcesses = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.cjs*start*'
        }
        if (-not $ServiceProcesses) {
            throw "Port $Port is occupied by another process. Stop it before updating pi-web-frq."
        }
        Write-Output '[RESTART] stopping the old server before rebuilding...'
        foreach ($ServiceProcess in $ServiceProcesses) {
            # /T 连同 Next 子进程一起结束，避免父进程停止后旧服务仍占用端口。
            & taskkill.exe /PID $ServiceProcess.ProcessId /T /F | Out-Null
        }
        for ($Attempt = 1; $Attempt -le 10; $Attempt++) {
            Start-Sleep -Milliseconds 500
            if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
        }
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            throw "The old server did not stop listening on port $Port. Run stop.bat and try again."
        }
    }
    Write-Output '[BUILD] npm run build (1-2 min)...'
    Push-Location $Root
    npm run build
    $BuildCode = $LASTEXITCODE
    Pop-Location
    if ($BuildCode -ne 0) { throw 'Build failed.' }
} else {
    # 无源码更新时，不重启已运行的服务。
    $Existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($Existing) {
        Write-Output "[OK] server already running at $Url"
        Start-Process $Url | Out-Null
        exit 0
    }
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
