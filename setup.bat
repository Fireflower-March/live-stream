@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Avatar Printer - Setup
if not exist ".venv\Scripts\python.exe" (
    where python >nul 2>nul
    if not errorlevel 1 (
        python -m venv .venv
    ) else (
        where py >nul 2>nul
        if errorlevel 1 goto no_python
        py -3 -m venv .venv
    )
    if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -m ensurepip --upgrade
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo.
echo Setup complete. Double-click start.bat to open Avatar Printer.
echo If WebView2 Runtime is missing, install it from:
echo https://developer.microsoft.com/microsoft-edge/webview2/
if /i not "%~1"=="--no-pause" pause
exit /b 0
:no_python
echo Python 3.10 or later is required. Install Python and run setup.bat again.
goto failed
:failed
echo.
echo Setup failed. Check the error above, then run setup.bat again.
if /i not "%~1"=="--no-pause" pause
exit /b 1
