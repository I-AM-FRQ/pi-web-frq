' pi-web-frq 后台静默启动：无窗口运行，服务在后台常驻（日志写 server.log）。
' 停止请运行 stop.bat（或 stop-hidden.vbs）。

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d """ & scriptDir & """ && node start.js >> start.log 2>&1", 0, False
