[CmdletBinding()]
param(
    [string]$Keystore = $env:TASKEN_ANDROID_KEYSTORE,
    [string]$KeystorePassword = $env:TASKEN_ANDROID_KEYSTORE_PASSWORD,
    [string]$KeyAlias = $env:TASKEN_ANDROID_KEY_ALIAS,
    [string]$KeyPassword = $env:TASKEN_ANDROID_KEY_PASSWORD
)

$required = [ordered]@{
    TASKEN_ANDROID_KEYSTORE = $Keystore
    TASKEN_ANDROID_KEYSTORE_PASSWORD = $KeystorePassword
    TASKEN_ANDROID_KEY_ALIAS = $KeyAlias
    TASKEN_ANDROID_KEY_PASSWORD = $KeyPassword
}
$missing = @(
    $required.GetEnumerator() |
        Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Value) } |
        ForEach-Object Key
)
if ($missing.Count -gt 0) {
    throw "Release signing is not configured. Missing: $($missing -join ', ')"
}
if (-not (Test-Path -LiteralPath $Keystore -PathType Leaf)) {
    throw "Release keystore does not exist: $Keystore"
}

$env:TASKEN_ANDROID_KEYSTORE = (Resolve-Path -LiteralPath $Keystore).Path
$env:TASKEN_ANDROID_KEYSTORE_PASSWORD = $KeystorePassword
$env:TASKEN_ANDROID_KEY_ALIAS = $KeyAlias
$env:TASKEN_ANDROID_KEY_PASSWORD = $KeyPassword

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

    $sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
    if ($sdkRoot) {
        $apksigner = Get-ChildItem -Path (Join-Path $sdkRoot "build-tools") -Filter "apksigner.bat" -Recurse -File |
            Sort-Object { [version]$_.Directory.Name } -Descending |
            Select-Object -First 1
        if ($apksigner) {
            & $apksigner.FullName verify --verbose $apk
            if ($LASTEXITCODE -ne 0) { throw "apksigner verification failed" }
        }
    }

    Write-Output (Resolve-Path -LiteralPath $apk).Path
}
finally {
    Pop-Location
}
