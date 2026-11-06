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
echo 还没有构建产物，先构建一次...
call pnpm.cmd build || goto :fail

:run
node tools\host-demo.mjs "%~dp0..\sandbox" %*
goto :eof

:fail
echo.
echo 构建失败，看上面的报错。
pause
