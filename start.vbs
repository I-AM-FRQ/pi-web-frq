' pi-web-frq 一键启动（无窗口）：双击本文件即可。
' 后台运行服务（日志写 server.log），并自动打开浏览器。停止运行 stop.bat。

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d """ & scriptDir & """ && node start.js >> start.log 2>&1", 0, False
