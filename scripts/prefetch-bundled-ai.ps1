# =====================================================================
# scripts/prefetch-bundled-ai.ps1
# ---------------------------------------------------------------------
#  Run this ONCE before `build.bat` to ship Scribble with a fully
#  self-contained AI: end users will install Scribble and chat without
#  ever downloading anything extra.
#
#  What it does:
#    1. Downloads the official Ollama Windows standalone ZIP into
#       src-tauri\bundled-ai\runtime\
#    2. Boots that ollama.exe pointed at src-tauri\bundled-ai\models\
#    3. Pulls llama3.2:3b into that models folder
#    4. Stops the temporary server
#
#  After this, ``build.bat`` will pick those folders up via
#  ``tauri.conf.json -> bundle.resources`` and pack them inside the
#  Scribble installer (NSIS / MSI). Resulting installer is a few GB.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File scripts\prefetch-bundled-ai.ps1
#    powershell -ExecutionPolicy Bypass -File scripts\prefetch-bundled-ai.ps1 -Model llama3.2:1b
#    powershell -ExecutionPolicy Bypass -File scripts\prefetch-bundled-ai.ps1 -SkipModel
# =====================================================================

[CmdletBinding()]
param(
    [string] $OllamaVersion = "v0.5.11",
    [string] $Model         = "llama3.2:3b",
    [int]    $Port          = 11436,           # different from the runtime app's :11435
    [switch] $SkipModel,
    [switch] $Force                            # re-download even if files exist
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root           = Split-Path -Parent $PSScriptRoot
$bundleRoot     = Join-Path $root "src-tauri\bundled-ai"
$runtimeDir     = Join-Path $bundleRoot "runtime"
$modelsDir      = Join-Path $bundleRoot "models"
$zipName        = "ollama-windows-amd64.zip"
$zipUrl         = "https://github.com/ollama/ollama/releases/download/$OllamaVersion/$zipName"
$tempZip        = Join-Path $env:TEMP "scribble-$zipName"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Scribble — prefetch-bundled-ai ($OllamaVersion / $Model)"  -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ---- 1. Download + extract runtime ---------------------------------
$ollamaExe = Join-Path $runtimeDir "ollama.exe"
if ((Test-Path $ollamaExe) -and -not $Force) {
    Write-Host "[1/3] Runtime already present at $runtimeDir (skip; use -Force to redo)." -ForegroundColor Green
} else {
    if (Test-Path $runtimeDir) { Remove-Item -Recurse -Force $runtimeDir }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

    Write-Host "[1/3] Downloading $zipUrl"
    Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing

    Write-Host "       Extracting to $runtimeDir"
    Expand-Archive -Path $tempZip -DestinationPath $runtimeDir -Force
    Remove-Item $tempZip -Force

    if (-not (Test-Path $ollamaExe)) {
        # Some versions extract into a nested directory; flatten if needed.
        $nested = Get-ChildItem -Recurse -Path $runtimeDir -Filter "ollama.exe" |
                  Select-Object -First 1
        if ($nested) {
            Write-Host "       Flattening nested layout: $($nested.DirectoryName)"
            Get-ChildItem -Path $nested.DirectoryName | Move-Item -Destination $runtimeDir -Force
            Get-ChildItem -Path $runtimeDir -Directory |
                Where-Object { -not (Test-Path (Join-Path $_.FullName 'ollama.exe')) -and $_.GetFiles().Count -eq 0 } |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not (Test-Path $ollamaExe)) {
        throw "ollama.exe was not found inside $zipName after extraction. The release layout may have changed."
    }
}

# ---- 2. Pull the model ---------------------------------------------
if ($SkipModel) {
    Write-Host "[2/3] -SkipModel set; not pulling any model." -ForegroundColor Yellow
} else {
    New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

    $env:OLLAMA_HOST   = "127.0.0.1:$Port"
    $env:OLLAMA_MODELS = (Resolve-Path $modelsDir).Path

    Write-Host "[2/3] Booting temporary ollama serve on $($env:OLLAMA_HOST)"
    $serve = Start-Process -FilePath $ollamaExe -ArgumentList "serve" `
        -WorkingDirectory $runtimeDir `
        -WindowStyle Hidden -PassThru
    try {
        $tagsUrl = "http://127.0.0.1:$Port/api/tags"
        $ready   = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            try {
                $r = Invoke-WebRequest -Uri $tagsUrl -UseBasicParsing -TimeoutSec 2
                if ($r.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
        }
        if (-not $ready) {
            throw "Temporary ollama serve never came up on port $Port. Inspect $($serve.Id)."
        }

        Write-Host "       Pulling $Model — this may take a while (multi‑GB)"
        & $ollamaExe pull $Model
        if ($LASTEXITCODE -ne 0) {
            throw "ollama pull $Model failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Write-Host "[2/3] Stopping temporary server (pid $($serve.Id))"
        try { Stop-Process -Id $serve.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
}

# ---- 3. Summary ----------------------------------------------------
$totalBytes = (Get-ChildItem -Recurse -File $bundleRoot | Measure-Object -Property Length -Sum).Sum
$gb         = [math]::Round($totalBytes / 1GB, 2)

Write-Host "[3/3] Done. bundled-ai\ now occupies ~${gb} GB"   -ForegroundColor Green
Write-Host "      runtime: $runtimeDir"
Write-Host "      models : $modelsDir"
Write-Host ""
Write-Host "Next: run build.bat — the installer will package these folders." -ForegroundColor Cyan
