@echo off
chcp 936 >nul
rem ---------------------------------------------------------------
rem  梵境 Vance 开发环境启动器
rem  由桌面快捷方式调用：cmd /k start-dev.cmd
rem ---------------------------------------------------------------

set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;C:\Program Files\Git\cmd;%PATH%"
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

doskey t=pnpm.cmd test $*
doskey b=pnpm.cmd build $*
doskey k=pnpm.cmd typecheck $*
doskey i=pnpm.cmd install $*
doskey s=git status $*
doskey l=git log --oneline -10 $*
doskey ..=cd ..

echo   快捷命令（仅本窗口有效）:
echo     t  跑测试    b  构建    k  类型检查
echo     i  装依赖    s  git status    l  最近提交
echo.
echo   提示: PowerShell 里直接敲 pnpm 可能被执行策略拦住，
echo         改用 pnpm.cmd，或执行一次：
echo         Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
echo.

:done
