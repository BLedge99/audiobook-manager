<#
.SYNOPSIS
  Keeps the WSL distro alive so the audiobook stack survives between sessions.

.DESCRIPTION
  **The server does not crash. The virtual machine does.**

  WSL powers a distribution off 15 seconds after its last client session ends
  (`instanceIdleTimeout`, default 15000, in %USERPROFILE%\.wslconfig). Docker
  runs *inside* this distribution as a systemd service, so when the
  distribution powers off, systemd stops docker.service, and every container
  is SIGTERMed. The containers then exit 143 and it reads as "the server
  started and then crashed".

  The evidence is unambiguous in the systemd journal:

      Stopping docker.service - Docker Application Container Engine...
      dockerd: Processing signal 'terminated'
      Stopped docker.service - Docker Application Container Engine.
      ...
      Reached target poweroff.target - System Power Off.
      Shutting down.

  That is the whole distro being powered off, not a container failing. The
  server was serving 200s right up to the SIGTERM.

  Two layers, because neither one alone is enough:

    1. `instanceIdleTimeout=-1` in %USERPROFILE%\.wslconfig is the official
       switch and it is permanent. WSL reads it when the distribution starts,
       so it takes effect at the next WSL restart.

    2. A detached `wsl.exe` client session holds the distribution open right
       now. A distribution with a live client session is never idle, so it
       never powers off. This is what makes the fix work on the first run,
       before layer 1 has been picked up, and it is released by
       `make keepalive-stop`.

  Neither layer touches the product: no container, image, volume or port
  changes. Layer 1 is one WSL setting on this machine; layer 2 is one
  `wsl.exe` process.

.NOTES
  Output is transcribed to logs/wsl-lifecycle.log, because the detached
  keepalive session has no console whose output the caller could see.
#>

[CmdletBinding()]
param(
  # The WSL distribution to keep alive. Defaults to the default distribution.
  [string]$Distro,

  # Release the keepalive session instead of ensuring it.
  [switch]$Stop,

  # Do not touch %USERPROFILE%\.wslconfig. The keepalive alone is enough to
  # keep the stack up; this is the opt-out for a machine where the global WSL
  # setting must not change.
  [switch]$SkipConfig
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDirectory 'wsl-lifecycle.log'
$pidFile = Join-Path $logDirectory 'wsl-keepalive.pid'

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Start-Transcript -Path $logFile -Append | Out-Null

function Exit-WithTranscript([int]$code) {
  try { Stop-Transcript | Out-Null } catch { }
  exit $code
}

# --------------------------------------------------------------------------
# Layer 1: the permanent WSL setting.
# --------------------------------------------------------------------------

function Get-WslConfigPath {
  Join-Path $env:USERPROFILE '.wslconfig'
}

<#
  Ensures `[general] instanceIdleTimeout=-1` in %USERPROFILE%\.wslconfig.

  Returns $true when the file was changed. Everything else in the file is
  preserved: .wslconfig is machine-wide, and WSL silently ignores the whole
  file if it is malformed, so it is edited rather than rewritten.
#>
function Set-InstanceIdleTimeout {
  $path = Get-WslConfigPath
  $desired = 'instanceIdleTimeout=-1'

  $lines = @()
  if (Test-Path -LiteralPath $path) {
    $lines = @(Get-Content -LiteralPath $path)
  }

  # Find the [general] section and the key inside it. A key of the same name
  # in a different section does not count, so the section has to be tracked
  # rather than searched for on its own.
  $sectionIndex = -1
  $keyIndex = -1
  $inGeneral = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*\[(?<name>[^\]]+)\]\s*$') {
      $inGeneral = ($Matches['name'].Trim() -ieq 'general')
      if ($inGeneral) { $sectionIndex = $i }
      continue
    }
    if ($inGeneral -and $lines[$i] -match '^\s*instanceIdleTimeout\s*=') {
      $keyIndex = $i
    }
  }

  if ($keyIndex -ge 0) {
    if ($lines[$keyIndex].Trim() -ieq $desired) { return $false }
    $lines[$keyIndex] = $desired
  } elseif ($sectionIndex -ge 0) {
    # The section exists but not the key: add the key to it, immediately after
    # the section header.
    #
    # The split is explicit rather than a pair of overlapping ranges. An
    # overlapping range -- `$lines[0..$insert]` plus `$lines[$insert..$last]`
    # -- silently duplicates the line at `$insert`, which is how a working
    # `[general]` section came to hold its own key twice.
    $insert = $sectionIndex + 1
    $head = @(); if ($insert -gt 0) { $head = @($lines[0..($insert - 1)]) }
    $tail = @(); if ($insert -lt $lines.Count) { $tail = @($lines[$insert..($lines.Count - 1)]) }
    $lines = $head + @($desired) + $tail
  } else {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne '') { $lines += '' }
    $lines += '[general]'
    $lines += $desired
  }

  # Back up before writing. This file is machine-wide and outlives the repo.
  if (Test-Path -LiteralPath $path) {
    Copy-Item -LiteralPath $path -Destination "$path.bak" -Force
  }
  # No BOM: WSL's parser is happier with plain UTF-8, and a BOM in an INI
  # file is a classic way to make the first key invisible.
  [System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))
  return $true
}

# --------------------------------------------------------------------------
# Layer 2: the keepalive session.
# --------------------------------------------------------------------------

function Get-DefaultDistro {
  # `wsl --list --verbose` marks the default distribution with a leading '*'.
  $lines = & wsl.exe --list --verbose 2>$null
  foreach ($line in $lines) {
    if ($line -match '^\*\s+(?<name>\S+)') { return $Matches['name'] }
  }
  return $null
}

function Get-RecordedKeepalivePid {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $raw = Get-Content -LiteralPath $pidFile -Raw
  if (-not $raw) { return $null }
  $parsed = 0
  if (-not [int]::TryParse($raw.Trim(), [ref]$parsed)) { return $null }
  return $parsed
}

function Test-KeepaliveRunning {
  param([int]$ProcessId)
  if (-not $ProcessId) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

<#
  Converts a Windows path to its WSL path, so the keepalive script can be
  launched from inside the distribution by path rather than by an awkward
  nested-quote command line.
#>
function ConvertTo-WslPath {
  param([string]$WindowsPath, [string]$DistroName)
  $result = & wsl.exe -d $DistroName --exec wslpath -a $WindowsPath 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  $line = $result | Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Trim()
}

function Start-Keepalive {
  param([string]$DistroName)

  $existing = Get-RecordedKeepalivePid
  if (Test-KeepaliveRunning -ProcessId $existing) {
    Write-Host "Keepalive session already held (pid $existing)."
    return $true
  }

  $keepaliveScript = Join-Path $PSScriptRoot 'wsl-keepalive.sh'
  $wslScript = ConvertTo-WslPath -WindowsPath $keepaliveScript -DistroName $DistroName
  if (-not $wslScript) {
    throw "Could not translate '$keepaliveScript' into a WSL path for distribution '$DistroName'."
  }

  # The quoting here is not cosmetic, and it is not what a C runtime would do.
  #
  # wsl.exe strips double quotes from the arguments it hands to --exec (so a
  # repository path containing a space survives), but it does NOT strip them
  # from the value of -d: `-d "Ubuntu"` is parsed as a distribution literally
  # named "Ubuntu" and fails with WSL_E_DISTRO_NOT_FOUND. So the distribution
  # name goes in bare -- it is a plain identifier and never contains a space --
  # and only the script path is quoted.
  $argumentLine = "-d $DistroName --exec bash `"$wslScript`""
  $process = Start-Process -FilePath 'wsl.exe' -ArgumentList $argumentLine -WindowStyle Hidden -PassThru

  # Give the session a moment to attach, then confirm it is alive rather than
  # reporting success for a process that died on startup.
  Start-Sleep -Milliseconds 800
  if (-not (Test-KeepaliveRunning -ProcessId $process.Id)) {
    throw "The keepalive session exited immediately (wsl.exe exit code $($process.ExitCode))."
  }

  Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
  Write-Host "Keepalive session held for '$DistroName' (pid $($process.Id))."
  return $true
}

function Stop-Keepalive {
  param([string]$DistroName)

  $existing = Get-RecordedKeepalivePid
  if (Test-KeepaliveRunning -ProcessId $existing) {
    # Remove the sentinel first: that ends the script inside the distro,
    # which closes the client session cleanly. Killing the client alone can
    # leave the Linux-side loop running.
    & wsl.exe -d $DistroName --exec rm -f /tmp/audiobook-manager-keepalive 2>$null | Out-Null
    Stop-Process -Id $existing -Force -ErrorAction SilentlyContinue
    Write-Host "Keepalive session released (pid $existing)."
  } elseif ($existing) {
    # The recorded process is gone -- WSL was shut down underneath us, most
    # likely. Say so rather than reporting a release that did not happen.
    Write-Host "Keepalive session was already gone (pid $existing); cleared the recorded pid."
  } else {
    Write-Host 'No keepalive session was recorded; nothing to release.'
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------

try {
  $distroName = $Distro
  if (-not $distroName) { $distroName = Get-DefaultDistro }
  if (-not $distroName) { throw 'Could not determine the WSL distribution to keep alive.' }
  Write-Host "WSL distribution : $distroName"

  if ($Stop) {
    Stop-Keepalive -DistroName $distroName
    Exit-WithTranscript 0
  }

  if ($SkipConfig) {
    Write-Host 'WSL config       : left alone (-SkipConfig).'
  } else {
    try {
      if (Set-InstanceIdleTimeout) {
        Write-Host "WSL config       : set [general] instanceIdleTimeout=-1 in $(Get-WslConfigPath)."
        Write-Host '                    WSL keeps this distro alive permanently from the next WSL'
        Write-Host '                    restart. Until then the keepalive session below covers it.'
      } else {
        Write-Host 'WSL config       : [general] instanceIdleTimeout=-1 already set.'
      }
    } catch {
      # The setting is a convenience, not a requirement: the keepalive session
      # below keeps the stack up on its own. Say so and carry on.
      Write-Warning "Could not update $(Get-WslConfigPath): $($_.Exception.Message)"
      Write-Host '                    The keepalive session below still keeps the stack up.'
    }
  }

  Start-Keepalive -DistroName $distroName | Out-Null
  Exit-WithTranscript 0
} catch {
  Write-Host "FAILED: $($_.Exception.Message)"
  Exit-WithTranscript 1
}
