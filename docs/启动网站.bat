@echo off
cd /d "%~dp0"
echo 正在启动大乐透分析网站...
start "" python serve.py
timeout /t 2 >nul
start "" http://localhost:8000
echo 网站已打开。关闭此窗口或按 Ctrl+C 可停止服务。
pause
