@echo off
title Metrorail Grid Extractor
color 0A

echo.
echo  ==============================================
echo   METRORAIL GRID EXTRACTOR (Guardian V2.5)
echo  ==============================================
echo.

:: 1. Ensure we are in the script's directory (Fixes "File not found" errors)
cd /d "%~dp0"

:: 2. Check if Node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed or not in your PATH.
    echo  Please install Node.js to run this tool.
    echo.
    pause
    exit
)

:: 3. Run the script
echo  Running extraction script...
echo.
node extract-grid.js

echo.
echo  ==============================================
echo   DONE. Press any key to close.
echo  ==============================================
pause >nul