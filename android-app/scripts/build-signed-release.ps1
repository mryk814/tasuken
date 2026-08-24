[CmdletBinding()]
param(
    [string]$Keystore = $env:TASKEN_ANDROID_KEYSTORE,
    [string]$KeystorePassword = $env:TASKEN_ANDROID_KEYSTORE_PASSWORD,
    [string]$KeyAlias = $env:TASKEN_ANDROID_KEY_ALIAS,
    [string]$KeyPassword = $env:TASKEN_ANDROID_KEY_PASSWORD,
    [string]$LegacyKeystore = $env:TASKEN_ANDROID_LEGACY_KEYSTORE,
    [string]$LegacyKeystorePassword = $env:TASKEN_ANDROID_LEGACY_KEYSTORE_PASSWORD,
    [string]$LegacyKeyAlias = $env:TASKEN_ANDROID_LEGACY_KEY_ALIAS,
    [string]$LegacyKeyPassword = $env:TASKEN_ANDROID_LEGACY_KEY_PASSWORD,
    [string]$SigningLineage = $env:TASKEN_ANDROID_SIGNING_LINEAGE,
    [string]$RotationMinSdkVersion = $env:TASKEN_ANDROID_ROTATION_MIN_SDK_VERSION
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

$rotationValues = @{
    TASKEN_ANDROID_LEGACY_KEYSTORE = $LegacyKeystore
    TASKEN_ANDROID_LEGACY_KEYSTORE_PASSWORD = $LegacyKeystorePassword
    TASKEN_ANDROID_LEGACY_KEY_ALIAS = $LegacyKeyAlias
    TASKEN_ANDROID_LEGACY_KEY_PASSWORD = $LegacyKeyPassword
    TASKEN_ANDROID_SIGNING_LINEAGE = $SigningLineage
}
$rotationConfigured = $rotationValues.Values.Where({ -not [string]::IsNullOrWhiteSpace($_) }).Count -gt 0
if ($rotationConfigured) {
    $missingRotationValues = $rotationValues.GetEnumerator() |
        Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Value) } |
        ForEach-Object Key |
        Sort-Object
    if ($missingRotationValues.Count -gt 0) {
        throw "Signing rotation is incomplete. Missing: $($missingRotationValues -join ', ')"
    }
    if (-not (Test-Path -LiteralPath $LegacyKeystore -PathType Leaf)) {
        throw "Legacy release keystore does not exist: $LegacyKeystore"
    }
    if (-not (Test-Path -LiteralPath $SigningLineage -PathType Leaf)) {
        throw "Signing lineage does not exist: $SigningLineage"
    }

    $parsedRotationMinSdkVersion = 0
    if ([string]::IsNullOrWhiteSpace($RotationMinSdkVersion)) {
        $parsedRotationMinSdkVersion = 33
    }
    elseif (-not [int]::TryParse($RotationMinSdkVersion, [ref]$parsedRotationMinSdkVersion) -or $parsedRotationMinSdkVersion -lt 28) {
        throw "TASKEN_ANDROID_ROTATION_MIN_SDK_VERSION must be an integer greater than or equal to 28."
    }

    $env:TASKEN_ANDROID_LEGACY_KEYSTORE_PASSWORD = $LegacyKeystorePassword
    $env:TASKEN_ANDROID_LEGACY_KEY_PASSWORD = $LegacyKeyPassword
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

    if ($rotationConfigured) {
        $rotatedApk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release-rotated.apk"
        Remove-Item -LiteralPath $rotatedApk -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$rotatedApk.idsig" -Force -ErrorAction SilentlyContinue

        & $apksigner.FullName sign `
            --ks (Resolve-Path -LiteralPath $LegacyKeystore).Path `
            --ks-key-alias $LegacyKeyAlias `
            --ks-pass "env:TASKEN_ANDROID_LEGACY_KEYSTORE_PASSWORD" `
            --key-pass "env:TASKEN_ANDROID_LEGACY_KEY_PASSWORD" `
            --next-signer `
            --ks $env:TASKEN_ANDROID_KEYSTORE `
            --ks-key-alias $KeyAlias `
            --ks-pass "env:TASKEN_ANDROID_KEYSTORE_PASSWORD" `
            --key-pass "env:TASKEN_ANDROID_KEY_PASSWORD" `
            --lineage (Resolve-Path -LiteralPath $SigningLineage).Path `
            --rotation-min-sdk-version $parsedRotationMinSdkVersion `
            --out $rotatedApk `
            $apk
        if ($LASTEXITCODE -ne 0) {
            throw "apksigner rotation failed"
        }

        Move-Item -LiteralPath $rotatedApk -Destination $apk -Force
        Remove-Item -LiteralPath "$rotatedApk.idsig" -Force -ErrorAction SilentlyContinue
    }

    & $apksigner.FullName verify --verbose --print-certs --min-sdk-version 26 $apk
    if ($LASTEXITCODE -ne 0) {
        throw "apksigner verification failed"
    }

    Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Select-Object Path, Hash
    Write-Output (Resolve-Path -LiteralPath $apk).Path
}
finally {
    Pop-Location
}
