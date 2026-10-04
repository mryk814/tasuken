param([ValidateRange(0,65534)][int]$AuditDebugPort = 0)
$ErrorActionPreference = 'Stop'
$taskBoardRepo = Split-Path -Parent $PSScriptRoot
$taskBoardEvidence = Join-Path $taskBoardRepo 'output/task-board-audit/result.json'
if (-not (Test-Path -LiteralPath $taskBoardEvidence)) {
  throw 'Run node scripts/run-electron-node.mjs scripts/task-handoff-audit.mjs --task-board first.'
}
$taskBoardResult = Get-Content -Raw -Encoding utf8 -LiteralPath $taskBoardEvidence | ConvertFrom-Json
$taskBoardProfile = [IO.Path]::GetFullPath($taskBoardResult.userData)
$taskBoardExpectedPrefix = Join-Path ([IO.Path]::GetTempPath()) 'tasken-board-audit-'
if (-not $taskBoardProfile.StartsWith($taskBoardExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Preview profile is not the isolated task board fixture.'
}
if (-not (Test-Path -LiteralPath $taskBoardProfile)) { throw 'Fixture profile is missing. Run the audit again.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskBoardProfile 'research-desk.sqlite'))) { throw 'Fixture database is missing. Run the audit again.' }
$taskBoardPreviousProfile = $env:TASKEN_USER_DATA_DIR
$taskBoardPreviousCreation = $env:TASKEN_CORE_AI_ITEM_CREATE
$taskBoardArguments = @('.', '--disable-gpu', '--disable-gpu-compositing', "--user-data-dir=$taskBoardProfile")
if ($AuditDebugPort -gt 0) {
  $taskBoardArguments += "--remote-debugging-port=$AuditDebugPort"
  $taskBoardArguments += "--inspect=$($AuditDebugPort + 1)"
}
try {
  $env:TASKEN_USER_DATA_DIR = $taskBoardProfile
  $env:TASKEN_CORE_AI_ITEM_CREATE = '1'
  # This is the interactive preview the user explicitly requested.
  $taskBoardProcess = Start-Process -FilePath (Join-Path $taskBoardRepo 'node_modules/electron/dist/electron.exe') -WorkingDirectory $taskBoardRepo -ArgumentList $taskBoardArguments -WindowStyle Normal -PassThru
  Write-Output "Isolated Tasken preview launch PID=$($taskBoardProcess.Id) userData=$taskBoardProfile (an existing preview is reused)"
} finally {
  $env:TASKEN_USER_DATA_DIR = $taskBoardPreviousProfile
  $env:TASKEN_CORE_AI_ITEM_CREATE = $taskBoardPreviousCreation
}
