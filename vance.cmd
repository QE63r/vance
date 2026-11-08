@echo off
rem ===============================================================
rem  Vance / 一键启动
rem  用法：  vance            局域网
rem          vance --tunnel   同时开公网隧道（4G 也能连）
rem  已在运行时：只显示地址，不会重复启动
rem ===============================================================
setlocal
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
cd /d "%~dp0"
chcp 936 >nul

rem 已经在跑？直接把地址亮出来就走
for /f "tokens=*" %%c in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":8787"') do goto :already

if exist "packages\host\dist\index.js" goto :run
echo 还有没构建的产物，先构建一次...
call pnpm.cmd build || goto :fail

:run
rem ---- 关键：把控制台代码页切成 UTF-8 ----
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "LANG=zh_CN.UTF-8"

node tools\host-demo.mjs "%~dp0..\sandbox" %*
goto :eof

:already
chcp 936 >nul
echo.
echo   梵境已经在跑了（端口 8787 被占用），不再重复启动。
if /i "%~1"=="--tunnel" (
  echo.
  echo   注意：已有 host 在跑，本次没有开新隧道。
  echo   要开公网：先关掉正在跑的 host，再按 v。
)
echo.
chcp 65001 >nul
node tools\print-url.mjs
chcp 936 >nul
echo.
if exist "%USERPROFILE%\.vance\tunnel-url.txt" (
  findstr /v /c:"api.trycloudflare.com" "%USERPROFILE%\.vance\tunnel-url.txt" >nul && (
    echo   公网地址：
    type "%USERPROFILE%\.vance\tunnel-url.txt"
    echo.
  )
)
if exist "%USERPROFILE%\.vance\qr.png" (
  echo   二维码图片：%USERPROFILE%\.vance\qr.png
)
echo.
goto :eof

:fail
echo.
echo Build failed. See the errors above.
pause
