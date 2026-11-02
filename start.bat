@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Avatar Printer - WebView2
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import webview" >nul 2>nul
    if errorlevel 1 goto missing_dependencies
    ".venv\Scripts\python.exe" launch.py %*
    if errorlevel 1 pause
    exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import webview" >nul 2>nul
    if errorlevel 1 goto missing_dependencies
    python launch.py %*
    if errorlevel 1 pause
    exit /b
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import webview" >nul 2>nul
    if errorlevel 1 goto missing_dependencies
    py -3 launch.py %*
    if errorlevel 1 pause
    exit /b
)
echo Python 3 is required.
pause
exit /b 1
:missing_dependencies
echo Desktop dependencies are missing. Run setup.bat once, then start.bat.
pause
exit /b 1
