<#
.SYNOPSIS
  Point the phone at the home server over USB, for when it cannot reach the LAN.

.DESCRIPTION
  The household's own setting is the server's address on the home network --
  `http://<your-lan-ip>:3000` -- and that is the right one. But the phone can
  end up on a WiFi segment that cannot reach the home LAN at all: `ping` to the
  host is 100% lost, and the app reports "failed to connect to server" for
  every request, including a download.

  `adb reverse` is the way through that. It tunnels the phone's own
  `localhost:3000` over the USB cable to the computer, so the phone reaches the
  server without needing the network to route anything. It needs no network at
  all.

  The tunnel is **the part that breaks silently**: it lives on the adb
  connection, so it dies when the cable is unplugged or the phone reboots, and
  nothing on the phone says so. The app just fails to connect. This script
  brings it back and checks that it works.

.PARAMETER Remove
  Take the tunnel down again.

.PARAMETER Port
  The port the server is published on. Keep in sync with docker-compose.yml.

.EXAMPLE
  scripts/device-tunnel.ps1
  scripts/device-tunnel.ps1 -Remove
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

function Get-Adb {
  # ANDROID_HOME if set, otherwise the standard SDK location.
  $candidates = @()
  if ($env:ANDROID_HOME) { $candidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
  if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
  $candidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw "adb not found. Set ANDROID_HOME to the Android SDK, or add it to PATH."
}

$adb = Get-Adb
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
$ErrorActionPreference = $previousErrorActionPreference
if (-not $devices) {
  throw "no device is connected. Plug the phone in and unlock it, then run `adb devices`."
}
$serial = ($devices | Select-Object -First 1) -split '\s+' | Select-Object -First 1
Write-Host "device: $serial"

if ($Remove) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $adb reverse --remove "tcp:$Port" | Out-Null
  $ErrorActionPreference = $previousErrorActionPreference
  Write-Host "tunnel on port $Port removed."
  exit 0
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $adb reverse "tcp:$Port" "tcp:$Port" | Out-Null
$list = & $adb reverse --list
$ErrorActionPreference = $previousErrorActionPreference
if ($list -notmatch "tcp:$Port") {
  throw "the tunnel did not take. Is the device still connected?"
}
Write-Host "tunnel up: the phone's localhost:$Port now reaches the computer's localhost:$Port."

Write-Host ""
Write-Host "The phone's server address has to match the tunnel for this to help."
Write-Host "It is currently whatever it was last set to -- Settings, Server address."
Write-Host "  http://localhost:$Port  reaches the server through the tunnel"
Write-Host "  http://<your-lan-ip>:$Port  reaches the server over the home network"
Write-Host ""
Write-Host "Check it from the phone:"
Write-Host "  adb reverse --list        # the tunnel is up"
Write-Host "  adb shell am start -n com.technative.audiobookmanager/.MainActivity"
