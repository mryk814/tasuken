[CmdletBinding()]
param(
  [string]$Source = "",
  [string]$Runtime = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Command が終了コード $LASTEXITCODE で失敗しました。"
    }
  } finally {
    Pop-Location
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "Windows runtime laneはWindows PowerShellから実行してください。"
}

if (-not $Source) {
  $Source = Split-Path -Parent $PSScriptRoot
}
if (-not $Runtime) {
  $Runtime = Join-Path $env:LOCALAPPDATA "TaskenDevRuntime\source"
}

$Source = [System.IO.Path]::GetFullPath($Source)
$Runtime = [System.IO.Path]::GetFullPath($Runtime)
$runtimeParent = Split-Path -Parent $Runtime

$sourceSha = (& git -C $Source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sourceSha) {
  throw "SourceのGit commitを確認できません: $Source"
}
$sourceChanges = @(& git -C $Source status --porcelain=v1)
if ($LASTEXITCODE -ne 0) {
  throw "SourceのGit状態を確認できません: $Source"
}
if ($sourceChanges.Count -gt 0) {
  throw "Windows runtime laneはcommit済みSHAだけを実行します。Sourceの変更をcommitしてから再実行してください。"
}

if (-not (Test-Path $Runtime)) {
  New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
  Invoke-Checked -Command "git" -Arguments @("clone", "--no-hardlinks", $Source, $Runtime) -WorkingDirectory $runtimeParent
} elseif (-not (Test-Path (Join-Path $Runtime ".git"))) {
  throw "RuntimeにGit cloneではない既存フォルダがあります: $Runtime"
}

$runtimeChanges = @(& git -C $Runtime status --porcelain=v1)
if ($LASTEXITCODE -ne 0) {
  throw "RuntimeのGit状態を確認できません: $Runtime"
}
if ($runtimeChanges.Count -gt 0) {
  throw "Runtimeに未commit変更があります。自動上書きしません: $Runtime"
}

Invoke-Checked -Command "git" -Arguments @("remote", "set-url", "origin", $Source) -WorkingDirectory $Runtime
Invoke-Checked -Command "git" -Arguments @("fetch", "--prune", "origin") -WorkingDirectory $Runtime
Invoke-Checked -Command "git" -Arguments @("checkout", "--detach", $sourceSha) -WorkingDirectory $Runtime

if (-not $SkipInstall) {
  Invoke-Checked -Command "npm.cmd" -Arguments @("ci") -WorkingDirectory $Runtime
}

$env:TASKEN_DEV_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA "TaskenDevRuntime\user-data"
Write-Host "Tasken Windows runtime: $sourceSha"
Write-Host "Source:  $Source"
Write-Host "Runtime: $Runtime"
Write-Host "Data:    $env:TASKEN_DEV_USER_DATA_DIR"
Invoke-Checked -Command "npm.cmd" -Arguments @("run", "dev") -WorkingDirectory $Runtime
