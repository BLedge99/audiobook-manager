<#
.SYNOPSIS
  Build the Android debug APK and install it on every ADB-ready device.

.DESCRIPTION
  Builds the Android web assets, syncs them into the Capacitor project,
  assembles the debug APK, and installs it on each connected ADB device.
  Devices that are unauthorized or offline are reported but not targeted.

.EXAMPLE
  .\scripts\install-android.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Get-Adb {
  $candidates = @()
  if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
  if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
  $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
  $pathAdb = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($pathAdb) { $candidates += $pathAdb.Source }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw "adb not found. Set ANDROID_HOME to the Android SDK, or add platform-tools to PATH."
}

$npm = Get-Command npm.cmd -ErrorAction Stop
$npx = Get-Command npx.cmd -ErrorAction Stop
$adb = Get-Adb
$sdkRoot = Split-Path -Parent (Split-Path -Parent $adb)
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$deviceOutput = @(& $adb devices 2>&1)
if ($LASTEXITCODE -ne 0) {
  throw "Could not query ADB devices: $($deviceOutput -join [Environment]::NewLine)"
}

$devices = [System.Collections.Generic.List[string]]::new()
$unavailable = [System.Collections.Generic.List[string]]::new()
foreach ($line in $deviceOutput) {
  if ($line -match '^\s*(\S+)\s+(device|unauthorized|offline)(?:\s|$)') {
    if ($Matches[2] -eq 'device') {
      $devices.Add($Matches[1])
    } else {
      $unavailable.Add("$($Matches[1]) ($($Matches[2]))")
    }
  }
}

if ($unavailable.Count -gt 0) {
  Write-Warning "ADB devices not ready for installation: $($unavailable -join ', ')."
}
if ($devices.Count -eq 0) {
  throw "No ADB-ready devices found. Connect a phone with USB debugging enabled, unlock it, and accept its USB debugging prompt."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$clientRoot = Join-Path $repoRoot 'client'
$androidRoot = Join-Path $clientRoot 'android'

Push-Location $clientRoot
try {
  Write-Host 'Building Android web assets...'
  & $npm.Source run build:android
  if ($LASTEXITCODE -ne 0) { throw "Android web build failed with exit code $LASTEXITCODE." }

  Write-Host 'Syncing Capacitor Android project...'
  & $npx.Source cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor Android sync failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

Push-Location $androidRoot
try {
  Write-Host 'Assembling debug APK...'
  & .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw "Android APK build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$apkPath = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apkPath)) {
  throw "Android build completed but the APK was not found at $apkPath."
}

$failedDevices = [System.Collections.Generic.List[string]]::new()
foreach ($serial in $devices) {
  Write-Host "Installing APK on $serial..."
  & $adb -s $serial install -r $apkPath
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "APK installation failed on $serial (exit code $LASTEXITCODE)."
    $failedDevices.Add($serial)
  } else {
    Write-Host "Installed successfully on $serial."
  }
}

if ($failedDevices.Count -gt 0) {
  throw "APK installation failed on: $($failedDevices -join ', ')."
}

Write-Host "APK installed on all $($devices.Count) connected device(s)."
