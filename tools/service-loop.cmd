@echo off
rem 守护进程：梵境退出（崩溃、被杀）后 5 秒自动重来。
rem 想彻底停掉：删掉计划任务，或运行 install-service.cmd remove
setlocal
:loop
call "%~dp0service.cmd"
timeout /t 5 /nobreak >nul
goto loop
