@echo off
rem ===============================================================
rem  Vance / 一键启动（本机 + 公网隧道 + 二维码）
rem  用法：  vance            局域网
rem          vance --tunnel   同时开公网隧道（4G 也能连）
rem ===============================================================
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0"

if exist "packages\host\dist\index.js" goto :run
echo 还有没构建的产物，先构建一次...
call pnpm.cmd build || goto :fail

:run
rem ---- 关键：把控制台代码页切成 UTF-8 ----
rem 子进程会继承这个代码页。让 Agent 的 PowerShell 直接输出 UTF-8，
rem 它就不必自己写一堆 [Console]::OutputEncoding 的补丁命令。
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "LANG=zh_CN.UTF-8"

node tools\host-demo.mjs "%~dp0..\sandbox" %*
goto :eof

:fail
echo.
echo Build failed. See the errors above.
pause
