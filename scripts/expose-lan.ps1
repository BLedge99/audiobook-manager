<#
.SYNOPSIS
  Exposes the audiobook server on the LAN so a phone can reach it.

.DESCRIPTION
  The whole stack runs inside WSL (Docker included). WSL's default NAT mode
  only relays the server to Windows on *loopback*:

      wslrelay.exe  127.0.0.1:3000  and  [::1]:3000

  So `http://192.168.1.203:3000` gets "connection refused" and an Android phone
  cannot download anything. This adds a Windows port proxy from the LAN address
  to the WSL guest address, plus a firewall rule, then probes the result.

  Why a script rather than one pasted command: the WSL guest IP **changes on
  every WSL restart**, so a hand-typed rule silently points at a dead address
  later. This resolves the IP fresh each run and is safe to re-run.

.NOTES
  Two privileged operations are needed: `netsh interface portproxy` and
  `New-NetFirewallRule`. Both require Administrator.

  The WSL and LAN addresses are resolved *before* elevating and passed to the
  elevated child as arguments. That is deliberate: `wsl.exe` cannot reach the
  WSL VM from an elevated process, so a child that tried to resolve the address
  itself would die immediately and silently. The child only runs `netsh`.

  Output is transcribed to logs/expose-lan.log, because the elevated child has
  its own console whose output the caller cannot see.
#>

[CmdletBinding()]
param(
  # Port the phone connects to. Keep in sync with docker-compose.yml.
  [int]$Port = 3000,

  # Passed in by the elevated child. When null, this script is the first pass
  # and resolves both addresses itself.
  [string]$WslAddress,
  [string]$LanAddress
)

$ErrorActionPreference = 'Stop'

$logDirectory = Join-Path $PSScriptRoot '..\logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logFile = Join-Path $logDirectory 'expose-lan.log'
Start-Transcript -Path $logFile -Append | Out-Null

function Exit-WithTranscript([int]$code) {
  try { Stop-Transcript | Out-Null } catch { }
  exit $code
}

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WslAddress {
  # `hostname -I` can list several addresses (WSL, plus Docker bridges). The
  # first is the WSL guest's own interface, which is the one we want; the rest
  # are docker0/bridge networks the phone cannot route to.
  $raw = & wsl.exe -e sh -c 'hostname -I' 2>$null
  $first = ($raw -split '\s+' | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1)
  if (-not $first) { throw "Could not read the WSL address. Is WSL running? Try: wsl -l -v" }
  return $first
}

function Get-LanAddress {
  # The phone sits on the same subnet as the host's physical adapter. Skip
  # loopback, link-local, and the Hyper-V/vEthernet adapters WSL creates.
  $address = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
      $_.InterfaceAlias -notmatch 'WSL|Loopback|Hyper-V|vEthernet'
    } |
    Select-Object -ExpandProperty IPAddress -First 1
  if (-not $address) { throw "No LAN adapter found. Is this machine on the same network as the phone?" }
  return $address
}

# --- First pass: resolve, then elevate ------------------------------------
if (-not $WslAddress -or -not $LanAddress) {
  $WslAddress = Get-WslAddress
  $LanAddress = Get-LanAddress
}

if (-not (Test-Admin)) {
  Write-Host "WSL guest address : $WslAddress"
  Write-Host "LAN address       : $LanAddress"
  Write-Host 'Not running as Administrator; requesting elevation (accept the UAC prompt)...'

  $scriptPath = $MyInvocation.MyCommand.Path
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$scriptPath`"",
    '-Port', $Port,
    '-WslAddress', $WslAddress,
    '-LanAddress', $LanAddress
  )
  # Release the log before the child opens it: two transcripts on one file lock
  # it, and the child would die at Start-Transcript.
  try { Stop-Transcript | Out-Null } catch { }
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  Start-Transcript -Path $logFile -Append | Out-Null
  Write-Host "Elevated run finished with exit code $($process.ExitCode). Full output: $logFile"
  Exit-WithTranscript $process.ExitCode
}

# --- Second pass: privileged work -----------------------------------------
Write-Host "WSL guest address : $WslAddress"
Write-Host "LAN address       : $LanAddress"
Write-Host "Port              : $Port"
Write-Host ''

# Delete before adding: `netsh ... delete` errors when the rule is absent, and a
# stale rule pointing at a previous WSL IP is exactly the bug this script exists
# to prevent.
$existing = netsh interface portproxy show v4tov4
$existingRule = $existing | Select-String -Pattern "^\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)" |
  Where-Object { [int]$_.Matches[0].Groups[2].Value -eq $Port } |
  Select-Object -First 1

if ($existingRule -and $existingRule.Matches[0].Groups[3].Value -eq $WslAddress) {
  Write-Host "Port proxy already correct: 0.0.0.0:$Port -> ${WslAddress}:$Port"
} else {
  if ($existingRule) {
    Write-Host "Replacing stale port proxy 0.0.0.0:$Port -> $($existingRule.Matches[0].Groups[3].Value):$Port"
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 | Out-Null
  } else {
    Write-Host "Adding port proxy 0.0.0.0:$Port -> ${WslAddress}:$Port"
  }
  netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 `
    connectport=$Port connectaddress=$WslAddress | Out-Null
}

# Firewall. Scope matters twice over:
#  - By *profile* it would be fragile: Windows marks this adapter **Public** (it
#    is not on a recognised domain), so a Private-scoped rule silently never
#    applies. `Any` avoids having to guess, and the rule is safe anyway.
#  - By *remote address* it stays tight: only hosts on this machine's own subnet
#    can connect, and only to this one port.
$ruleName = "AudiobookManager LAN $Port"
if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
  Write-Host "Refreshing firewall rule '$ruleName' (the previous one may be mis-scoped)"
  Remove-NetFirewallRule -DisplayName $ruleName
} else {
  Write-Host "Adding firewall rule '$ruleName'"
}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any | Out-Null

# --- Verify ---------------------------------------------------------------
# Prove it works rather than reporting success optimistically. A 401 is the
# expected *good* outcome: the request reached the server and the server
# demanded auth. Connection refused means it did not get through.
Write-Host ''
Write-Host "Probing http://${LanAddress}:$Port/api/health from this machine ..."
$reachable = $false
try {
  $response = Invoke-WebRequest -Uri "http://${LanAddress}:$Port/api/health" -TimeoutSec 5 -UseBasicParsing
  Write-Host "  HTTP $($response.StatusCode) - reachable."
  $reachable = $true
} catch {
  $status = $null
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  if ($status -eq 401) {
    Write-Host "  HTTP 401 - reachable; the server wants auth, which is expected."
    $reachable = $true
  } else {
    Write-Host "  FAILED: $($_.Exception.Message)"
  }
}

Write-Host ''
if ($reachable) {
  Write-Host "The phone can reach the server at:  http://${LanAddress}:$Port"
  Write-Host 'Set that as the server URL in the app''s settings screen.'
  Exit-WithTranscript 0
}

Write-Host 'The server is NOT reachable on the LAN. Check, in order:'
Write-Host '  1. The stack is up:   make start'
Write-Host "  2. It is up inside WSL: wsl -e curl -s -o /dev/null -w '%{http_code}' http://localhost:$Port/api/health"
Write-Host "  3. Windows can reach the WSL guest: Invoke-WebRequest http://$WslAddress`:$Port/api/health"
Exit-WithTranscript 1