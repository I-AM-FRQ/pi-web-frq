' pi-web-frq 一键启动（完全无窗口）：双击本文件，服务后台运行并自动打开浏览器。
' 停止请运行 stop.bat。启动输出写入同目录 start.log。

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = Replace(scriptDir & "\start.ps1", "'", "''")
logFile = Replace(scriptDir & "\start.log", "'", "''")

Set sh = CreateObject("WScript.Shell")
' WScript.Shell.Run 不解析 cmd 的 >> / 2>&1；使用 PowerShell 自身的 *>> 重定向。
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""& '" & psScript & "' *>> '" & logFile & "'"""
sh.Run command, 0, False
