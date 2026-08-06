' pi-web-frq 一键启动（完全无窗口）：双击本文件，服务后台运行并自动打开浏览器。
' 停止请运行 stop.bat。

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\start.ps1"" >> start.log 2>&1", 0, False
