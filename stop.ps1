$ErrorActionPreference = 'SilentlyContinue'

# ===== pi-web-frq 停止服务 =====
$Processes = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.cjs*start*'
}
if ($Processes) {
    foreach ($Process in $Processes) {
        # /T 连同 serve.cjs 启动的 Next 子进程一起结束，避免旧前端继续占用端口。
        & taskkill.exe /PID $Process.ProcessId /T /F | Out-Null
        Write-Output "Stopped PID $($Process.ProcessId) and its child processes"
    }
} else {
    Write-Output 'No running service found.'
}
