@echo off
cd /d "%~dp0"
python tools\serve.py
if errorlevel 1 pause
