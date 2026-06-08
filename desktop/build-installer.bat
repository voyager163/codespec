@echo off
REM ============================================================
REM  PowerCodex - one-click installer builder
REM  Double-click this file. It will:
REM    1) install the build tools (first run only, needs internet)
REM    2) bundle the whole app and produce the installer
REM    3) open the folder containing PowerCodex-Setup.exe
REM  Then run PowerCodex-Setup.exe to install + auto-launch.
REM ============================================================
setlocal
cd /d "%~dp0"
title PowerCodex - building installer

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found. Install it from https://nodejs.org/ ^(LTS^), then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo  [1/2] Installing build tools ^(first run only - this downloads Electron, please wait^)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo  [2/2] Building the installer...
REM  Unsigned local build: skip cert discovery + the build cache (which would pull
REM  the winCodeSign bundle), and trust the OS certificate store for downloads.
set "NODE_OPTIONS=--use-system-ca"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
set "ELECTRON_BUILDER_DISABLE_BUILD_CACHE=true"
call npm run dist:installer
if errorlevel 1 goto :failed

echo.
echo  Done!  Your installer is here:
echo      %~dp0dist\PowerCodex-Setup.exe
echo.
echo  Run it to install PowerCodex - it sets up shortcuts and launches automatically.
echo.
start "" "%~dp0dist"
pause
exit /b 0

:failed
echo.
echo  Build failed - see the messages above.
echo  Most common cause: no internet / a proxy blocking the Electron download.
echo.
pause
exit /b 1
