' pi-web-frq 后台静默启动：无窗口运行服务，日志写入 server.log。
' 停止请运行 stop.bat。

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set sh = CreateObject("WScript.Shell")
' 先构建（若 .next 缺失）
sh.Run "cmd /c cd /d """ & scriptDir & """ && if not exist .next\BUILD_ID npm run build", 0, True
' 后台启动服务，日志追加到 server.log
sh.Run "cmd /c cd /d """ & scriptDir & """ && node scripts\serve.cjs start >> server.log 2>&1", 0, False
