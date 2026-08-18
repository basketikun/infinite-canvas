$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$release = Join-Path $root 'release'
$manifest = Get-Content (Join-Path $root 'ASSET_MANIFEST.json') -Raw | ConvertFrom-Json
$unpacked = Join-Path $release 'win-unpacked'
$unpackedExe = Get-ChildItem $unpacked -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch 'uninstall|elevate' } | Select-Object -First 1
if (-not $unpackedExe) { throw 'win-unpacked application executable not found' }

function Assert-RuntimeAssets([string]$resources) {
  $ffmpeg = Join-Path $resources 'ffmpeg\ffmpeg.exe'
  $ffprobe = Join-Path $resources 'ffmpeg\ffprobe.exe'
  $license = Join-Path $resources 'licenses\FFmpeg-GPL-3.0.txt'
  foreach ($item in @($ffmpeg, $ffprobe, $license)) {
    if (-not (Test-Path $item)) { throw "Packaged runtime asset missing: $item" }
  }
  $expected = $manifest.assets.windowsFfmpeg.files
  if ((Get-FileHash $ffmpeg -Algorithm SHA256).Hash.ToLower() -ne $expected.'ffmpeg.exe') {
    throw 'Packaged ffmpeg.exe checksum mismatch'
  }
  if ((Get-FileHash $ffprobe -Algorithm SHA256).Hash.ToLower() -ne $expected.'ffprobe.exe') {
    throw 'Packaged ffprobe.exe checksum mismatch'
  }
  if ((Get-FileHash $license -Algorithm SHA256).Hash.ToLower() -ne $expected.'LICENSE.txt') {
    throw 'Packaged FFmpeg license checksum mismatch'
  }
}

function Test-AppLaunch([string]$executable, [string]$label, [string]$resources) {
  $process = $null
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  $tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
  $oldPath = $env:PATH
  $oldFfmpeg = $env:BLOCKOUT_FFMPEG
  $oldConfigDir = $env:BLOCKOUT_CONFIG_DIR
  $oldConfigNamespace = $env:BLOCKOUT_CONFIG_NAMESPACE
  $oldAppData = $env:APPDATA
  $env:PATH = "$env:SystemRoot\System32"
  Remove-Item Env:BLOCKOUT_FFMPEG -ErrorAction SilentlyContinue
  Remove-Item Env:BLOCKOUT_CONFIG_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:BLOCKOUT_CONFIG_NAMESPACE -ErrorAction SilentlyContinue
  $env:BLOCKOUT_SMOKE_DIR = Join-Path $tempRoot "OneDrive - Studio\Director's Cut\José\Packaged Smoke"
  $env:APPDATA = Join-Path $tempRoot ("blockout-default-appdata-" + [guid]::NewGuid().ToString('N'))
  $bridgeName = if ($env:BLOCKOUT_EXPECTED_MCP_ENTRY) { $env:BLOCKOUT_EXPECTED_MCP_ENTRY } else { 'blockout-mcp.mjs' }
  $bridge = Join-Path $resources (Join-Path 'mcp' $bridgeName)
  $namespace = if ($env:BLOCKOUT_EXPECTED_CONFIG_NAMESPACE) { $env:BLOCKOUT_EXPECTED_CONFIG_NAMESPACE } else { 'blockout' }
  $descriptorPath = Join-Path (Join-Path $env:APPDATA $namespace) 'control.json'
  New-Item -ItemType Directory -Force -Path $env:BLOCKOUT_SMOKE_DIR | Out-Null
  try {
    $process = Start-Process -FilePath $executable -PassThru
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $descriptorPath) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
    }
    if ($process.HasExited) { throw "$label exited during launch smoke with code $($process.ExitCode)" }
    if (-not (Test-Path $descriptorPath)) {
      throw "$label did not write its descriptor to the default namespace: $descriptorPath"
    }
    $descriptor = Get-Content $descriptorPath -Raw | ConvertFrom-Json
    if ($descriptor.protocolVersion -ne 1 -or $descriptor.app -ne 'blockout' -or $descriptor.capabilities -notcontains 'rpc') {
      throw "$label wrote an invalid control descriptor to $descriptorPath"
    }
    $healthReady = $false
    $healthDeadline = (Get-Date).AddSeconds(15)
    while (-not $healthReady -and (Get-Date) -lt $healthDeadline) {
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($descriptor.port)/health" -TimeoutSec 2
        $healthReady = $health.ok -and $health.protocolVersion -eq 1
      } catch {
        Start-Sleep -Milliseconds 250
      }
    }
    if (-not $healthReady) { throw "$label control health endpoint did not become ready" }
    if (-not (Test-Path $bridge)) { throw "$label packaged MCP entry is missing: $bridge" }
    & $nodeExe (Join-Path $root 'scripts\verify-packaged-mcp.mjs') $bridge
    if ($LASTEXITCODE -ne 0) { throw "$label packaged MCP smoke failed with $LASTEXITCODE" }
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  } finally {
    if ($process -and -not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    $env:PATH = $oldPath
    if ($null -ne $oldFfmpeg) { $env:BLOCKOUT_FFMPEG = $oldFfmpeg }
    if ($null -ne $oldConfigDir) { $env:BLOCKOUT_CONFIG_DIR = $oldConfigDir } else { Remove-Item Env:BLOCKOUT_CONFIG_DIR -ErrorAction SilentlyContinue }
    if ($null -ne $oldConfigNamespace) { $env:BLOCKOUT_CONFIG_NAMESPACE = $oldConfigNamespace } else { Remove-Item Env:BLOCKOUT_CONFIG_NAMESPACE -ErrorAction SilentlyContinue }
    $env:APPDATA = $oldAppData
  }
}

Assert-RuntimeAssets (Join-Path $unpacked 'resources')
Test-AppLaunch $unpackedExe.FullName 'win-unpacked app' (Join-Path $unpacked 'resources')

$installer = Get-ChildItem $release -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch 'uninstall' } | Sort-Object Length -Descending | Select-Object -First 1
if (-not $installer) { throw 'NSIS installer not found' }
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Blockout Test José'
Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Silent NSIS install failed with $($install.ExitCode)" }

$installedExe = Get-ChildItem $installDir -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch 'uninstall|elevate' } | Select-Object -First 1
if (-not $installedExe) { throw 'Installed application executable not found' }
Assert-RuntimeAssets (Join-Path $installDir 'resources')

$startMenuShortcut = Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Filter 'Blockout*.lnk' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$desktopShortcut = Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter 'Blockout*.lnk' -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $startMenuShortcut) { throw 'Start Menu shortcut was not created' }
if (-not $desktopShortcut) { throw 'Desktop shortcut was not created' }
Test-AppLaunch $installedExe.FullName 'installed app' (Join-Path $installDir 'resources')

# Uninstall removes program files/shortcuts but deliberately preserves user data.
$dataRoot = Join-Path $env:APPDATA 'blockout'
$marker = Join-Path $dataRoot 'uninstall-preserves-user-data.marker'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Set-Content -Path $marker -Value 'preserve'
$uninstaller = Get-ChildItem $installDir -Filter '*Uninstall*.exe' -File | Select-Object -First 1
if (-not $uninstaller) { throw 'NSIS uninstaller not found' }
$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Silent uninstall failed with $($uninstall.ExitCode)" }
Start-Sleep -Seconds 2
if (Test-Path $installedExe.FullName) { throw 'Application executable remains after uninstall' }
if (-not (Test-Path $marker)) { throw 'Uninstall unexpectedly removed the user-data root' }

if (Get-Command Start-MpScan -ErrorAction SilentlyContinue) {
  $scanCompleted = $false
  try {
    Start-MpScan -ScanType CustomScan -ScanPath $release
    $scanCompleted = $true
  } catch {
    Write-Warning "Microsoft Defender custom scan unavailable or inconclusive: $($_.Exception.Message)"
  }
  if ($scanCompleted) {
    $threats = @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object {
      $_.Resources -match [regex]::Escape($release)
    })
    if ($threats.Count -gt 0) { throw "Microsoft Defender reported $($threats.Count) release threat(s)" }
    Write-Host 'Microsoft Defender custom scan completed with no release threats.'
  }
} else {
  Write-Warning 'Microsoft Defender cmdlets are unavailable on this runner.'
}

Write-Host 'Windows unpacked launch, silent install/launch/uninstall, resources, shortcuts, and data policy passed.'
