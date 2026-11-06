@echo off
rem ---------------------------------------------------------------
rem  梵境开发窗口
rem  打开方式：双击，或在文件夹地址栏输入  cmd /k start-dev.cmd
rem ---------------------------------------------------------------

rem 先把 PATH 修好（继承来的 PATH 可能没有 System32），再 chcp，
rem 否则 chcp 本身会报"不是内部或外部命令"
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Microsoft VS Code\bin;%PATH%"
if defined PATH_EXTRA set "PATH=%PATH%;%PATH_EXTRA%"
chcp 936 >nul
cd /d "%~dp0"

echo.
echo   梵境 Vance  ^|  把人从电脑屏幕前解放出来
echo   ==================================================
echo.
echo   Node    :
node -v
echo   pnpm    :
call pnpm.cmd -v
echo   Git     :
git --version
echo   Path    : %CD%
echo.

if /i "%~1"=="--check" goto :done

where doskey >nul 2>nul
if errorlevel 1 goto :nodoskey

rem 起服务（二维码直接印在这个窗口里）
doskey v=call vance.cmd --tunnel $*
rem 只开局域网，不走隧道
doskey vl=call vance.cmd $*
doskey t=pnpm.cmd test $*
doskey b=pnpm.cmd build $*
doskey k=pnpm.cmd typecheck $*
doskey i=pnpm.cmd install $*
doskey s=git status $*
doskey l=git log --oneline -10 $*
doskey c=code . $*
doskey ..=cd ..
doskey u=type "%USERPROFILE%\.vance\tunnel-url.txt"

echo   快捷命令（仅本窗口有效）:
echo     v  启动梵境（公网+二维码）    vl 启动（只局域网）
echo     u  看当前地址（服务常驻时用）
echo     t  跑测试    b  构建    k  类型检查
echo     i  装依赖    s  git status    l  最近提交    c  VS Code
echo.
echo   启动后：手机扫窗口里的二维码即可连上。
echo.
goto :tips

:nodoskey
echo   提示: 没找到 doskey，快捷命令不可用。
echo         直接用  vance.cmd --tunnel  启动。
echo.

:tips
echo   注: 公网地址每次重启都会变（trycloudflare 的机制）。
echo       二维码和地址也会写到  %%USERPROFILE%%\.vance\qr.png 和 tunnel-url.txt
echo.

:done
endlocal
