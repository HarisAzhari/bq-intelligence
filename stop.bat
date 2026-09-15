@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" server_control.py stop
pause
