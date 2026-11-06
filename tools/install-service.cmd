@echo off
rem 开机自启（不需要管理员）：把启动脚本放进用户的“启动”文件夹。
rem   install-service.cmd          安装
rem   install-service.cmd remove   移除
setlocal
set "PATH=%SystemRoot%\System32;%PATH%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\vance-autostart.cmd"

if /i "%~1"=="remove" goto :remove

rem 写进启动文件的是 GBK 编码（cmd 默认读 GBK），所以先切回 936
chcp 936 >nul
> "%TARGET%" echo @echo off
>> "%TARGET%" echo rem 梵境开机自启（由 install-service.cmd 生成，删掉本文件即可取消）
>> "%TARGET%" echo start "" /min cmd /c "%~dp0service-loop.cmd"

if not exist "%TARGET%" (
  echo 写入失败：%TARGET%
  pause
  exit /b 1
)
echo.
echo 已安装：登录 Windows 后自动在后台启动梵境。
echo   启动文件：%TARGET%
echo   查看地址：在开发窗口敲 u
echo   取消自启：install-service.cmd remove
echo.
pause
goto :eof

:remove
if exist "%TARGET%" ( del "%TARGET%" && echo 已移除开机自启。 ) else ( echo 本来就没装。 )
pause
