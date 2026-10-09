@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ==========================================================
rem  build.bat
rem  --------
rem  Single-command release build for Scribble.
rem
rem  Pipeline:
rem    1. npm install      (only if node_modules is missing)
rem    2. tsc + vite build → ./dist
rem    3. tauri build      → NSIS .exe installer (per-user)
rem    4. WiX 5            → custom per-user .msi installer
rem
rem  Final installers (both per-user — no admin prompt):
rem    Output\Scribble_Setup.exe       (NSIS, ~1.5 MB)
rem    Output\Scribble_Setup.msi       (WiX,  ~3-4 MB)
rem
rem  Usage:
rem    build.bat                Build both installers.
rem    build.bat --clean        Wipe node_modules + Rust target/ first.
rem    build.bat --nsis-only    Skip the WiX MSI step.
rem    build.bat --msi-only     Skip the NSIS step (still needs the exe).
rem ==========================================================

set "CLEAN=0"
set "DO_NSIS=1"
set "DO_MSI=1"

:argloop
if "%~1"=="" goto endargs
if /I "%~1"=="--clean"      set "CLEAN=1"   & shift & goto argloop
if /I "%~1"=="--nsis-only"  set "DO_MSI=0"  & shift & goto argloop
if /I "%~1"=="--msi-only"   set "DO_NSIS=0" & shift & goto argloop
if /I "%~1"=="-h"           goto help
if /I "%~1"=="--help"       goto help
echo Unknown argument: %~1
goto help
:endargs

echo ==========================================
echo Scribble release build (native, per-user)
echo ==========================================

if exist "src-tauri\bundled-ai\runtime\ollama.exe" (
  echo Bundled AI: runtime present ^(installer will ship a self-contained AI^).
) else (
  echo Bundled AI: NOT prefetched. Installer will fall back to runtime download.
  echo            Run: powershell -ExecutionPolicy Bypass -File scripts\prefetch-bundled-ai.ps1
)
echo.

if "%CLEAN%"=="1" (
  echo Cleaning node_modules, dist, src-tauri\target ...
  if exist node_modules         rmdir /s /q node_modules
  if exist dist                 rmdir /s /q dist
  if exist src-tauri\target     rmdir /s /q src-tauri\target
)

rem ---- prerequisites --------------------------------------
where node >nul 2>&1  || (echo ERROR: node not on PATH. Install Node 18+ from https://nodejs.org & exit /b 1)
where cargo >nul 2>&1 || (echo ERROR: cargo not on PATH. Install Rust from https://rustup.rs & exit /b 1)
where rustc >nul 2>&1 || (echo ERROR: rustc not on PATH. Install Rust from https://rustup.rs & exit /b 1)

rem ---- [1/4] npm install ----------------------------------
if not exist node_modules (
  echo [1/4] Installing JS dependencies ...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (echo ERROR: npm install failed & exit /b 1)
) else (
  echo [1/4] Using existing node_modules\
)

rem ---- [2/4] Frontend bundle ------------------------------
echo.
echo [2/4] Building frontend bundle ...
call npm run build
if errorlevel 1 (echo ERROR: frontend build failed & exit /b 1)

rem ---- [3/4] Tauri / Rust + NSIS --------------------------
echo.
echo [3/4] Building native binary + NSIS installer ...
call npx tauri build
if errorlevel 1 (echo ERROR: tauri build failed & exit /b 1)

if not exist Output mkdir Output

if "%DO_NSIS%"=="1" (
  for %%F in ("src-tauri\target\release\bundle\nsis\Scribble_*-setup.exe") do (
    copy /Y "%%~fF" "Output\Scribble_Setup.exe" >nul
  )
)

rem ---- [4/4] WiX per-user MSI -----------------------------
if "%DO_MSI%"=="1" (
  echo.
  echo [4/4] Compiling per-user MSI with WiX ...
  where wix >nul 2>&1
  if errorlevel 1 (
    where dotnet >nul 2>&1 || (echo ERROR: dotnet not on PATH; cannot install WiX. Skipping MSI. & goto :skip_msi)
    echo Installing WiX 5 as a dotnet global tool ...
    call dotnet tool install --global wix --version 5.0.2
    if errorlevel 1 (echo ERROR: dotnet tool install wix failed & exit /b 1)
  )
  call wix extension list -g | findstr /I "WixToolset.UI.wixext" >nul
  if errorlevel 1 (
    echo Installing WixToolset.UI.wixext ...
    call wix extension add -g WixToolset.UI.wixext/5.0.2
    if errorlevel 1 (echo ERROR: wix extension add failed & exit /b 1)
  )
  call wix build installer.wxs -ext WixToolset.UI.wixext -out "Output\Scribble_Setup.msi"
  if errorlevel 1 (echo ERROR: wix build failed & exit /b 1)
)
:skip_msi

echo.
echo ==========================================
echo Build complete.
echo ==========================================
if exist "Output\Scribble_Setup.exe" (
  for %%F in ("Output\Scribble_Setup.exe") do echo   NSIS: %%~zF bytes  Output\Scribble_Setup.exe
)
if exist "Output\Scribble_Setup.msi" (
  for %%F in ("Output\Scribble_Setup.msi") do echo   MSI:  %%~zF bytes  Output\Scribble_Setup.msi
)
echo.
echo Both installers install per-user (no admin prompt).
exit /b 0

:help
echo Usage:
echo   build.bat              Build both NSIS .exe and per-user MSI installers.
echo   build.bat --clean      Wipe node_modules + target before building.
echo   build.bat --nsis-only  Only produce the NSIS .exe installer.
echo   build.bat --msi-only   Only produce the WiX per-user MSI installer.
exit /b 0
