@echo off
setlocal
echo ====================================================
echo   Figma MCP Bridge - 1-Click Automated Setup
echo ====================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies if server node_modules missing
if not exist "%~dp0server\node_modules" (
    echo [*] Installing server dependencies...
    cd /d "%~dp0server"
    call npm install --no-audit --no-fund
    cd /d "%~dp0"
)

:: Run harness auto-configurator
echo [*] Configuring AI agent harnesses...
node "%~dp0scripts\setup-harness.js"

echo.
echo ====================================================
echo   Setup Complete!
echo ====================================================
echo 1. Open Google Chrome and go to: chrome://extensions
echo 2. Enable "Developer mode" (top right toggle)
echo 3. Click "Load unpacked" and select this folder:
echo    %~dp0
echo 4. Restart Claude Desktop / Cursor / Antigravity
echo ====================================================
pause
