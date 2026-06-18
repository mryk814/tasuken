param(
  [Parameter(Mandatory=$true)]
  [string[]]$TargetDirs,

  [string]$Output = "ai-context.md",

  [int]$MaxFileKB = 4096
)

$base = (Get-Location).Path
$outPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)

$excludeDirs = @(
  ".git", "node_modules", "dist", "build", ".next", ".venv", "venv",
  "coverage", ".idea", ".vscode"
)

$excludeExts = @(
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".zip", ".7z", ".tar", ".gz", ".exe", ".dll", ".bin",
  ".lock", ".mp4", ".mov", ".mp3", ".wav"
)

function Is-SkippedPath($file) {
  if ($file.FullName -eq $outPath) {
    return $true
  }

  $pathParts = $file.FullName -split "[\\/]"
  foreach ($dir in $excludeDirs) {
    if ($pathParts -contains $dir) {
      return $true
    }
  }

  if ($excludeExts -contains $file.Extension.ToLower()) {
    return $true
  }

  if ($file.Length -gt ($MaxFileKB * 1024)) {
    return $true
  }

  return $false
}

function Get-Lang($ext) {
  switch ($ext.ToLower()) {
    ".ps1" { "powershell" }
    ".js" { "javascript" }
    ".jsx" { "jsx" }
    ".ts" { "typescript" }
    ".tsx" { "tsx" }
    ".py" { "python" }
    ".html" { "html" }
    ".css" { "css" }
    ".json" { "json" }
    ".yml" { "yaml" }
    ".yaml" { "yaml" }
    ".md" { "markdown" }
    ".sql" { "sql" }
    default { "" }
  }
}

function Get-CodeFence($content) {
  $matches = [regex]::Matches($content, '`+')

  $maxLen = 3
  foreach ($match in $matches) {
    if ($match.Value.Length -gt $maxLen) {
      $maxLen = $match.Value.Length
    }
  }

  return ('`' * ($maxLen + 1))
}

$resolvedDirs = $TargetDirs | ForEach-Object {
  (Resolve-Path $_).Path
}

$files = foreach ($dir in $resolvedDirs) {
  Get-ChildItem -Path $dir -Recurse -File
}

$files = $files |
  Where-Object { -not (Is-SkippedPath $_) } |
  Sort-Object FullName -Unique

$lines = New-Object System.Collections.Generic.List[string]

$lines.Add("# AI Context Export")
$lines.Add("")
$lines.Add("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$lines.Add("")
$lines.Add("## Target Directories")
$lines.Add("")

foreach ($dir in $resolvedDirs) {
  $relativeDir = [System.IO.Path]::GetRelativePath($base, $dir)
  $lines.Add(('- `{0}`' -f $relativeDir))
}

$lines.Add("")
$lines.Add("## Files")
$lines.Add("")

foreach ($file in $files) {
  $relative = [System.IO.Path]::GetRelativePath($base, $file.FullName)
  $lines.Add(('- `{0}`' -f $relative))
}

$lines.Add("")
$lines.Add("## Contents")
$lines.Add("")

foreach ($file in $files) {
  $relative = [System.IO.Path]::GetRelativePath($base, $file.FullName)
  $lang = Get-Lang $file.Extension

  try {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction Stop
  } catch {
    $content = "[Could not read file]"
  }

  $fence = Get-CodeFence $content

  $lines.Add(('### `{0}`' -f $relative))
  $lines.Add("")
  $lines.Add(('{0}{1}' -f $fence, $lang))
  $lines.Add($content)
  $lines.Add($fence)
  $lines.Add("")
}

[System.IO.File]::WriteAllLines(
  $outPath,
  $lines,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Exported $($files.Count) files to $outPath"