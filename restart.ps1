#Requires -Version 5.1

<#
.SYNOPSIS
    Rebuild and restart Procview via PM2.
.DESCRIPTION
    Runs a production build (next build) then restarts the Procview PM2 process.
    Useful after code changes to pick up both server-side and frontend updates.
.PARAMETER SkipBuild
    Skip the build step and only restart PM2. Use when only server-side CJS
    files changed (no React/Next.js component changes).
.EXAMPLE
    .\restart.ps1
    # Rebuild and restart
.EXAMPLE
    .\restart.ps1 -SkipBuild
    # Restart PM2 without rebuilding (server-side only changes)
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = $PSScriptRoot
Push-Location $ProjectRoot

try {
    # --- Verify PM2 is available -------------------------------------------
    $pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2Cmd) {
        Write-Host '  PM2 is not installed. Install via: npm install -g pm2' -ForegroundColor Red
        exit 1
    }

    # --- Build -------------------------------------------------------------
    if (-not $SkipBuild) {
        Write-Host '  Building for production...' -ForegroundColor Cyan
        & yarn build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  Build failed. PM2 not restarted.' -ForegroundColor Red
            exit 1
        }
        Write-Host '  Build complete.' -ForegroundColor Green
    }
    else {
        Write-Host '  Skipping build (-SkipBuild).' -ForegroundColor Yellow
    }

    # --- Restart PM2 -------------------------------------------------------
    Write-Host '  Restarting PM2 process...' -ForegroundColor Cyan
    & pm2 restart procview 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  PM2 restart failed. Is procview registered? Try: pm2 start ecosystem.config.js' -ForegroundColor Red
        exit 1
    }
    Write-Host '  Procview restarted.' -ForegroundColor Green
}
finally {
    Pop-Location
}
