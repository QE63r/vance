@echo off
chcp 936 >nul
rem ---------------------------------------------------------------
rem  梵境 Vance 开发环境启动器
rem  由桌面快捷方式调用：cmd /k start-dev.cmd
rem ---------------------------------------------------------------

rem 不依赖继承来的 PATH（有的机器上它是空的），System32 显式放最前
set "PATH=%SystemRoot%\System32;%SystemRoot%;C:\Program Files\nodejs;%APPDATA%\npm;C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Microsoft VS Code\bin;%PATH%"
if defined PATH_EXTRA set "PATH=%PATH%;%PATH_EXTRA%"
cd /d "%~dp0"

echo.
echo   梵境 Vance  ^|  cross-ecosystem agent control plane
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

doskey t=pnpm.cmd test $*
doskey b=pnpm.cmd build $*
doskey k=pnpm.cmd typecheck $*
doskey i=pnpm.cmd install $*
doskey s=git status $*
doskey l=git log --oneline -10 $*
doskey ..=cd ..
doskey c=code . $*

echo   快捷命令（仅本窗口有效）:
echo     t  跑测试    b  构建    k  类型检查
echo     i  装依赖    s  git status    l  最近提交    c  VS Code
echo.
goto :tips

:nodoskey
echo   提示: 本机找不到 doskey，快捷命令不可用。
echo         直接用 pnpm.cmd test / build / typecheck 即可。
echo.

:tips
echo   注: PowerShell 里直接敲 pnpm 可能被执行策略拦住，
echo       改用 pnpm.cmd，或执行一次：
echo       Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
echo.

:done
