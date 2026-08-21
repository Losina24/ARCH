#Requires -Version 5.1
# One-line installer for ARCH end users (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/Losina24/ARCH/main/scripts/install.ps1 | iex
#
# Clones ARCH into a dedicated directory, builds it, and links the `archctl`
# and `arch-terminal` executables onto your PATH. Safe to re-run to update.

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/Losina24/ARCH.git'
$InstallDir = if ($env:ARCH_INSTALL_DIR) { $env:ARCH_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'arch-cli' }

function Write-Info($Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Fail($Message) { Write-Host "Error: $Message" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git is required but was not found on PATH.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js >= 20 is required but was not found on PATH. Install it from https://nodejs.org/ and re-run this script.'
}

$nodeMajor = [int](node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 20) {
  Fail "Node.js >= 20 is required (found $(node -v))."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Info 'pnpm not found, enabling it via Corepack...'
  corepack enable
  corepack prepare pnpm@10 --activate
}

if (Test-Path (Join-Path $InstallDir '.git')) {
  Write-Info "Updating existing installation at $InstallDir..."
  git -C $InstallDir fetch --depth 1 origin
  git -C $InstallDir reset --hard origin/HEAD
} else {
  Write-Info "Cloning ARCH into $InstallDir..."
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  git clone --depth 1 $RepoUrl $InstallDir
}

Set-Location $InstallDir

Write-Info 'Installing dependencies...'
pnpm install --frozen-lockfile

Write-Info 'Building ARCH...'
pnpm build

Write-Info "Ensuring pnpm's global bin directory is configured..."
try { pnpm setup *> $null } catch { }

Write-Info 'Linking archctl and arch-terminal globally...'
# `pnpm --dir <path> link --global` resolves the workspace root instead of the target
# package inside a pnpm workspace, so the actual working directory has to change instead.
Push-Location (Join-Path $InstallDir 'packages/cli')
try {
  pnpm link --global
  if ($LASTEXITCODE -ne 0) {
    Fail 'Could not link archctl globally. If pnpm just configured its global bin directory for the first time, restart your terminal and re-run this script.'
  }
} finally {
  Pop-Location
}
Push-Location (Join-Path $InstallDir 'packages/tui')
try {
  pnpm link --global
  if ($LASTEXITCODE -ne 0) {
    Fail 'Could not link arch-terminal globally. If pnpm just configured its global bin directory for the first time, restart your terminal and re-run this script.'
  }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. Restart your terminal (so the updated PATH takes effect), then run:' -ForegroundColor Green
Write-Host '    archctl --help'
Write-Host '    arch-terminal'
