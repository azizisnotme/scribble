# Build Scribble for school Windows laptops (portable-first).
# School antivirus often deletes NSIS installers instantly (unsigned + embedded WebView2).
# Default output: Scribble_Portable folder + .zip + SHA256 for IT allowlisting.
# Pass -WithInstaller only if you still want Scribble_Setup.exe (often quarantined).

param(
  [switch]$WithInstaller
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root "Output"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# Drop stale installers so nobody copies the wrong file to school.
foreach ($stale in @("Scribble_Setup.exe", "Scribble_Setup.msi")) {
  $p = Join-Path $Out $stale
  if ((Test-Path $p) -and -not $WithInstaller) {
    Remove-Item -Force $p
  }
}

function Get-FileSha256Hex {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash($stream)
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
  }
}

Write-Host "Building Scribble portable (no NSIS installer - avoids most school AV)..." -ForegroundColor Cyan
Push-Location $Root
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  npx tauri build --config src-tauri/tauri.conf.school.json
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

  if ($WithInstaller) {
    Write-Host "Also building NSIS installer (may be deleted by school AV)..." -ForegroundColor Yellow
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build (installer) failed" }
  }
} finally {
  Pop-Location
}

$ExeSrc = Join-Path $Root "src-tauri\target\release\scribble-desktop.exe"
if (-not (Test-Path $ExeSrc)) {
  throw "App binary not found at $ExeSrc"
}

# Portable: folder users copy to Desktop/Documents (no install step)
$PortableDir = Join-Path $Out "Scribble_Portable"
if (Test-Path $PortableDir) { Remove-Item -Recurse -Force $PortableDir }
New-Item -ItemType Directory -Force -Path $PortableDir | Out-Null

$ResSrc = Join-Path $Root "src-tauri\target\release\resources"
Copy-Item -Force $ExeSrc (Join-Path $PortableDir "Scribble.exe")
if (Test-Path $ResSrc) {
  Copy-Item -Recurse -Force $ResSrc (Join-Path $PortableDir "resources")
}

@'
@echo off
cd /d "%~dp0"
start "" "%~dp0Scribble.exe"
'@ | Set-Content -Path (Join-Path $PortableDir "Run Scribble.bat") -Encoding ASCII

$ZipPath = Join-Path $Out "Scribble_Portable.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path (Join-Path $PortableDir "*") -DestinationPath $ZipPath -Force

$Hashes = @()
$Hashes += "Scribble.exe`t$(Get-FileSha256Hex (Join-Path $PortableDir 'Scribble.exe'))"
$Hashes += "Scribble_Portable.zip`t$(Get-FileSha256Hex $ZipPath)"
$HashFile = Join-Path $Out "FILE-HASHES-SHA256.txt"
@(
  "SHA-256 hashes for IT allowlisting (Scribble v0.2.0 student build, unsigned)"
  "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  ""
  ($Hashes -join "`n")
  ""
  "Ask IT to allow these files by hash or path, or exclude the Scribble_Portable folder."
) | Set-Content -Path $HashFile -Encoding UTF8

if ($WithInstaller) {
  $SetupSrc = Join-Path $Root "src-tauri\target\release\bundle\nsis\Scribble_0.2.0_x64-setup.exe"
  if (Test-Path $SetupSrc) {
    $SetupDst = Join-Path $Out "Scribble_Setup.exe"
    Copy-Item -Force $SetupSrc $SetupDst
    Add-Content -Path $HashFile -Value "Scribble_Setup.exe`t$(Get-FileSha256Hex $SetupDst)"
    Write-Host "  (installer copied - expect AV to quarantine at school)" -ForegroundColor Yellow
  }
}

$guide = @'
SCRIBBLE — SCHOOL INSTALL GUIDE
==============================

*** READ THIS FIRST — SCHOOL ANTIVIRUS ***
Most school PCs delete Scribble_Setup.exe immediately (unsigned installer).
DO NOT use the installer on school laptops. Use PORTABLE only (below).

If Windows Security removed a file:
  - Open Windows Security → Protection history → see what was quarantined.
  - Use Scribble_Portable.zip (Option A), not Scribble_Setup.exe.
  - Give your teacher FILE-HASHES-SHA256.txt and ask IT to allowlist Scribble.exe.


OPTION A — PORTABLE (use this at school)
----------------------------------------
1. Copy Scribble_Portable.zip to the school PC (email, OneDrive, or USB).
2. Right-click the zip → Extract All → put the folder on Desktop or Documents.
3. Open the Scribble_Portable folder.
4. Double-click "Run Scribble.bat".
5. No admin password needed.

If SmartScreen says "Windows protected your PC":
  - Click More info → Run anyway (this is an unsigned student build).

If the window is blank or the app closes immediately, the PC needs WebView2
(usually already on Windows 11). Ask IT to install:
https://go.microsoft.com/fwlink/p/?LinkId=2124703


OPTION B — INSTALLER (home PC only — usually blocked at school)
---------------------------------------------------------------
Scribble_Setup.exe is often deleted by school antivirus before it can run.
Only try this on a personal PC, or if IT has allowlisted the file.

1. Right-click Scribble_Setup.exe → Properties → Unblock → OK.
2. Double-click and follow the install wizard.
3. Install goes to your user folder (no admin required).


FOR IT / TEACHERS
-----------------
Product: Scribble (typing assistant, Tauri desktop app, per-user install).
Publisher: unsigned student build — false positives are common.
Allowlist: Scribble.exe in the portable folder (hashes in FILE-HASHES-SHA256.txt).
Avoid: blocking NSIS-style setup stubs; portable folder is lower risk.


TROUBLESHOOTING
---------------
- File vanished right after download → school AV quarantine; use portable zip + IT.
- Typing (F9) only works in the installed desktop app, not in browser preview.
'@

Set-Content -Path (Join-Path $Out "SCHOOL-INSTALL-GUIDE.txt") -Value $guide -Encoding UTF8

Write-Host ""
Write-Host "Done. Copy these to school (portable first):" -ForegroundColor Green
Write-Host "  $ZipPath"
Write-Host "  $PortableDir\"
Write-Host "  $HashFile"
Write-Host "  $(Join-Path $Out 'SCHOOL-INSTALL-GUIDE.txt')"
if ($WithInstaller -and (Test-Path (Join-Path $Out "Scribble_Setup.exe"))) {
  Write-Host "  $(Join-Path $Out 'Scribble_Setup.exe')  (optional - often blocked)"
}
