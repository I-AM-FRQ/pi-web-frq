@echo off
chcp 936 >nul
echo Stopping pi-web-frq...

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*serve.cjs*start*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ('Stopped PID ' + $_.ProcessId) }"

echo Done. Close the server window if it is still open.
pause