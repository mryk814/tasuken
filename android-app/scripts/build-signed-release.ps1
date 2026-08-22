[CmdletBinding()]
param(
    [string]$Keystore = $env:TASKEN_ANDROID_KEYSTORE,
    [string]$KeystorePassword = $env:TASKEN_ANDROID_KEYSTORE_PASSWORD,
    [string]$KeyAlias = $env:TASKEN_ANDROID_KEY_ALIAS,
    [string]$KeyPassword = $env:TASKEN_ANDROID_KEY_PASSWORD
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($Keystore)) {
    if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) {
        throw "Release keystore does not exist: $Keystore"
    }
    $env:TASKEN_ANDROID_KEYSTORE = (Resolve-Path -LiteralPath $Keystore).Path
}
if (-not [string]::IsNullOrWhiteSpace($KeystorePassword)) {
    $env:TASKEN_ANDROID_KEYSTORE_PASSWORD = $KeystorePassword
}
if (-not [string]::IsNullOrWhiteSpace($KeyAlias)) {
    $env:TASKEN_ANDROID_KEY_ALIAS = $KeyAlias
}
if (-not [string]::IsNullOrWhiteSpace($KeyPassword)) {
    $env:TASKEN_ANDROID_KEY_PASSWORD = $KeyPassword
}

$androidRoot = Split-Path -Parent $PSScriptRoot
Push-Location $androidRoot
try {
    & .\gradlew.bat --no-daemon verifyReleaseSigning assembleRelease
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle release build failed with exit code $LASTEXITCODE"
    }

    $apk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
        throw "Signed release APK was not produced: $apk"
    }

    $sdkCandidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk" })
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    $apksigner = $null
    foreach ($sdkRoot in $sdkCandidates) {
        $buildTools = Join-Path $sdkRoot "build-tools"
        if (-not (Test-Path -LiteralPath $buildTools -PathType Container)) {
            continue
        }
        $apksigner = Get-ChildItem -LiteralPath $buildTools -Filter "apksigner.bat" -Recurse -File |
            Sort-Object {
                try { [version]$_.Directory.Name } catch { [version]"0.0" }
            } -Descending |
            Select-Object -First 1
        if ($apksigner) {
            break
        }
    }

    if (-not $apksigner) {
        throw "Android apksigner was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT, or install Android build-tools."
    }

    & $apksigner.FullName verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) {
        throw "apksigner verification failed"
    }

    Write-Output (Resolve-Path -LiteralPath $apk).Path
}
finally {
    Pop-Location
}
