#Requires -Version 5.1

<#
.SYNOPSIS
    Start the Procview unified process dashboard.
.DESCRIPTION
    Validates prerequisites, installs dependencies if needed, and launches
    the Procview server in development or production mode. Detects available
    collectors (PM2, Docker, System) and reports their status at startup.
.PARAMETER Mode
    Server mode: 'dev' for development with hot-reload, 'production' for
    optimized production build. Defaults to 'production'.
.PARAMETER Port
    Port to run the server on. Defaults to 7829 or the value in .env.local.
.PARAMETER NoBrowser
    Skip opening the browser after the server starts.
.PARAMETER SkipInstall
    Skip the yarn install step even if node_modules is missing.
.PARAMETER Build
    Force a fresh production build before starting in production mode.
    Enabled by default.
.EXAMPLE
    .\start.ps1
    # Start in production mode with rebuild on default port
.EXAMPLE
    .\start.ps1 -Port 3000
    # Start in production mode on port 3000
.EXAMPLE
    .\start.ps1 -Mode dev
    # Start in development mode with hot-reload
.EXAMPLE
    .\start.ps1 -Build:$false
    # Start production without rebuilding (use existing .next/)
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('dev', 'production')]
    [string]$Mode = 'production',

    [switch]$Dev,

    [ValidateRange(1, 65535)]
    [int]$Port,

    [switch]$NoBrowser,

    [switch]$SkipInstall,

    [bool]$Build = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Dev) { $Mode = 'dev' }

$ProjectRoot = $PSScriptRoot
Push-Location $ProjectRoot

# --- Helpers ----------------------------------------------------------------

function Write-Banner {
    $banner = @'

                           _
  _ __  _ __ ___   ___ __  _(_) _____      __
 | '_ \| '__/ _ \ / __\ \ / / |/ _ \ \ /\ / /
 | |_) | | | (_) | (__ \ V /| |  __/\ V  V /
 | .__/|_|  \___/ \___| \_/ |_|\___| \_/\_/
 |_|
       Unified Process Dashboard

'@
    Write-Host $banner -ForegroundColor Cyan
}

function Write-Status {
    param(
        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter(Mandatory)]
        [string]$Value,

        [ValidateSet('Green', 'Yellow', 'Red', 'Cyan', 'Gray')]
        [string]$Color = 'Gray'
    )
    Write-Host "  $($Label.PadRight(18))" -NoNewline -ForegroundColor DarkGray
    Write-Host $Value -ForegroundColor $Color
}

function Test-CommandExists {
    param([Parameter(Mandatory)][string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    if (-not (Test-CommandExists 'node')) { return $null }
    $raw = & node --version 2>$null
    if ($raw -match '^v?(\d+)') { return [int]$Matches[1] }
    return $null
}

function Test-DockerRunning {
    if (-not (Test-CommandExists 'docker')) { return $false }
    try {
        $out = & docker info --format '{{.ServerVersion}}' 2>$null
        return (-not [string]::IsNullOrWhiteSpace($out))
    }
    catch { return $false }
}

function Test-PM2Available {
    if (-not (Test-CommandExists 'pm2')) { return $false }
    try {
        $null = & pm2 ping 2>$null
        return ($LASTEXITCODE -eq 0)
    }
    catch { return $false }
}

function Get-EnvPort {
    $envFile = Join-Path $ProjectRoot '.env.local'
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw
        if ($content -match '(?m)^\s*PORT\s*=\s*(\d+)') {
            return [int]$Matches[1]
        }
    }
    return $null
}

function Test-PortInUse {
    param([Parameter(Mandatory)][int]$PortNumber)
    $listener = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $listener -and $listener.Count -gt 0)
}

function Open-Browser {
    param([Parameter(Mandatory)][string]$Url)
    Start-Process $Url
}

# --- Prerequisite Checks ---------------------------------------------------

Write-Banner

Write-Host '  Checking prerequisites...' -ForegroundColor DarkGray
Write-Host ''

# Node.js
$nodeMajor = Get-NodeVersion
if ($null -eq $nodeMajor) {
    Write-Status 'Node.js' 'NOT FOUND' 'Red'
    Write-Host ''
    Write-Host '  Node.js is required. Install from https://nodejs.org/' -ForegroundColor Red
    Pop-Location
    exit 1
}
if ($nodeMajor -lt 18) {
    Write-Status 'Node.js' "v$nodeMajor (need 18+)" 'Red'
    Write-Host ''
    Write-Host '  Node.js 18 or later is required.' -ForegroundColor Red
    Pop-Location
    exit 1
}
$nodeFullVersion = (& node --version 2>$null).TrimStart('v')
Write-Status 'Node.js' "v$nodeFullVersion" 'Green'

# Yarn
if (-not (Test-CommandExists 'yarn')) {
    Write-Status 'Yarn' 'NOT FOUND' 'Red'
    Write-Host ''
    Write-Host '  Yarn is required. Install via: npm install -g yarn' -ForegroundColor Red
    Pop-Location
    exit 1
}
$yarnVersion = & yarn --version 2>$null
Write-Status 'Yarn' "v$yarnVersion" 'Green'

# PM2 (optional)
$pm2Running = Test-PM2Available
if ($pm2Running) {
    $pm2Version = & pm2 --version 2>$null
    Write-Status 'PM2' "v$pm2Version (daemon running)" 'Green'
}
elseif (Test-CommandExists 'pm2') {
    Write-Status 'PM2' 'installed (daemon not running)' 'Yellow'
}
else {
    Write-Status 'PM2' 'not installed (optional)' 'Gray'
}

# Docker (optional)
$dockerRunning = Test-DockerRunning
if ($dockerRunning) {
    $dockerVersion = & docker --version 2>$null
    if ($dockerVersion -match '(\d+\.\d+\.\d+)') { $dockerVersion = $Matches[1] }
    Write-Status 'Docker' "v$dockerVersion (running)" 'Green'
}
elseif (Test-CommandExists 'docker') {
    Write-Status 'Docker' 'installed (not running)' 'Yellow'
}
else {
    Write-Status 'Docker' 'not installed (optional)' 'Gray'
}

Write-Host ''

# --- Resolve Port -----------------------------------------------------------

if (-not $Port) {
    $envPort = Get-EnvPort
    if ($envPort) { $Port = $envPort }
    else { $Port = 7829 }
}

if (Test-PortInUse -PortNumber $Port) {
    Write-Host "  Port $Port is already in use." -ForegroundColor Red
    Write-Host ''

    # Find the process holding the port
    $holders = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($holders) {
        foreach ($h in $holders) {
            $proc = Get-Process -Id $h.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Held by: $($proc.ProcessName) (PID $($proc.Id))" -ForegroundColor Yellow
            }
        }
    }

    Write-Host ''
    Write-Host '  Use -Port to specify a different port, or stop the conflicting process.' -ForegroundColor Gray
    Pop-Location
    exit 1
}

# --- Install Dependencies ---------------------------------------------------

$nodeModulesPath = Join-Path $ProjectRoot 'node_modules'
$needsInstall = -not (Test-Path $nodeModulesPath)

if ($needsInstall -and -not $SkipInstall) {
    Write-Host '  Installing dependencies...' -ForegroundColor Cyan
    & yarn install --frozen-lockfile 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '  yarn install failed.' -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host '  Dependencies installed.' -ForegroundColor Green
    Write-Host ''
}
elseif ($needsInstall -and $SkipInstall) {
    Write-Host '  node_modules missing and -SkipInstall set. May fail.' -ForegroundColor Yellow
    Write-Host ''
}

# --- Ensure data directory --------------------------------------------------

$dataDir = Join-Path $ProjectRoot 'data'
if (-not (Test-Path $dataDir)) {
    New-Item -Path $dataDir -ItemType Directory -Force | Out-Null
    Write-Host '  Created data/ directory for SQLite database.' -ForegroundColor DarkGray
    Write-Host ''
}

# --- Production Build -------------------------------------------------------

if ($Mode -eq 'production') {
    $nextDir = Join-Path $ProjectRoot '.next'
    $needsBuild = $Build -or -not (Test-Path $nextDir)

    if ($needsBuild) {
        Write-Host '  Building for production...' -ForegroundColor Cyan
        & yarn build 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        if ($LASTEXITCODE -ne 0) {
            Write-Host ''
            Write-Host '  Production build failed.' -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host '  Build complete.' -ForegroundColor Green
        Write-Host ''
    }
}

# --- Start Server -----------------------------------------------------------

$serverUrl = "http://localhost:$Port"

Write-Host '  ────────────────────────────────────────' -ForegroundColor DarkGray
Write-Status 'Mode' $Mode $(if ($Mode -eq 'dev') { 'Yellow' } else { 'Green' })
Write-Status 'URL' $serverUrl 'Cyan'
Write-Status 'PM2 collector' $(if ($pm2Running) { 'active' } else { 'unavailable' }) $(if ($pm2Running) { 'Green' } else { 'Gray' })
Write-Status 'Docker collector' $(if ($dockerRunning) { 'active' } else { 'unavailable' }) $(if ($dockerRunning) { 'Green' } else { 'Gray' })
Write-Status 'System collector' 'active' 'Green'
Write-Host '  ────────────────────────────────────────' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

# Open browser after a short delay (non-blocking)
if (-not $NoBrowser) {
    $null = Start-Job -ScriptBlock {
        param($Url)
        Start-Sleep -Seconds 3
        Start-Process $Url
    } -ArgumentList $serverUrl
}

# Set PORT env var for the server
$env:PORT = $Port

try {
    if ($Mode -eq 'dev') {
        & node --watch-path=./server.js --watch-path=./src/lib server.js
    }
    else {
        $env:NODE_ENV = 'production'
        & node server.js
    }
}
finally {
    Pop-Location
    # Clean up background browser job
    Get-Job | Where-Object { $_.State -eq 'Completed' } | Remove-Job -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host '  Procview stopped.' -ForegroundColor DarkGray
}
