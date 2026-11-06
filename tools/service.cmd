@echo off
rem 梵境常驻服务：由计划任务在登录时拉起，输出写日志文件。
rem 用户看不到这个窗口（后台跑），所以地址写到隧道文件里，用 v 或 u 查看。
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0.."
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if not exist "packages\host\dist\index.js" (
  call pnpm.cmd build >> "%USERPROFILE%\.vance\service.log" 2>&1
)

node tools\host-demo.mjs "%~dp0..\..\sandbox" --tunnel >> "%USERPROFILE%\.vance\service.log" 2>&1
