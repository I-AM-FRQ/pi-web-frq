$ErrorActionPreference = 'SilentlyContinue'

# ===== pi-web-frq 停止服务 =====
$Processes = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.cjs*start*'
}
if ($Processes) {
    foreach ($Process in $Processes) {
        Stop-Process -Id $Process.ProcessId -Force
        Write-Output "Stopped PID $($Process.ProcessId)"
    }
} else {
    Write-Output 'No running service found.'
}
