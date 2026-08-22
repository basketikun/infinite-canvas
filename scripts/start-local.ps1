$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$temp = [IO.Path]::GetTempPath()
$agentOutputLog = Join-Path $temp "infinite-canvas-agent-output.log"
$agentErrorLog = Join-Path $temp "infinite-canvas-agent-error.log"

function Stop-ManagedProcess([string]$name) {
    $pidPath = Join-Path $temp "infinite-canvas-$name.pid"
    if (!(Test-Path $pidPath)) { return }
    $existing = [int](Get-Content $pidPath | Select-Object -First 1)
    if (Get-Process -Id $existing -ErrorAction SilentlyContinue) {
        taskkill.exe /PID $existing /T /F | Out-Null
        Start-Sleep -Milliseconds 300
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Start-ManagedProcess([string]$name, [string]$filePath, [string[]]$arguments, [string]$workingDirectory, [bool]$restart = $false, [string]$outputLog = "", [string]$errorLog = "") {
    $pidPath = Join-Path $temp "infinite-canvas-$name.pid"
    if (Test-Path $pidPath) {
        $existing = [int](Get-Content $pidPath | Select-Object -First 1)
        if (Get-Process -Id $existing -ErrorAction SilentlyContinue) {
            if (!$restart) { return }
            Stop-ManagedProcess $name
        } else {
            Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
        }
    }

    $options = @{ FilePath = $filePath; ArgumentList = $arguments; WorkingDirectory = $workingDirectory; WindowStyle = "Hidden"; PassThru = $true }
    if ($outputLog) { $options.RedirectStandardOutput = $outputLog }
    if ($errorLog) { $options.RedirectStandardError = $errorLog }
    $started = Start-Process @options
    $started.Id | Set-Content -Path $pidPath
}

function Confirm-AgentReady([string]$outputLog, [string]$errorLog) {
    $lastError = "Canvas Agent did not open port 17371."
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $config = Invoke-RestMethod -Uri "http://127.0.0.1:17371/config" -TimeoutSec 2
            if ($config.ok -and $config.protocolVersion -eq 8) { return }
            $lastError = "Canvas Agent started with protocol v$($config.protocolVersion), but this page requires v8."
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    $logTail = @($outputLog, $errorLog | Where-Object { Test-Path $_ } | ForEach-Object { Get-Content -LiteralPath $_ -Tail 20 }) -join [Environment]::NewLine
    $text = "Canvas Agent failed to start.`n$lastError`n`nLogs: $outputLog`n$errorLog`n`n$logTail"
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($text, "Canvas Agent", "OK", "Error") | Out-Null
    } catch {
        Write-Error $text
    }
    throw $lastError
}

$web = Join-Path $root "web"
$agent = Join-Path $root "canvas-agent"
$bun = (Get-Command bun.exe -ErrorAction Stop).Source
$viteCommand = 'cd /d "' + $web + '" && bun run dev'
if (!(Test-Path (Join-Path $agent "node_modules\\tsx\\package.json"))) {
    $install = Start-Process -FilePath $bun -ArgumentList @("install", "--frozen-lockfile") -WorkingDirectory $agent -RedirectStandardOutput $agentOutputLog -RedirectStandardError $agentErrorLog -WindowStyle Hidden -PassThru -Wait
    if ($install.ExitCode -ne 0) { throw "Canvas Agent dependency install failed. See $agentErrorLog" }
}
Start-ManagedProcess "vite" $env:ComSpec @("/d", "/c", $viteCommand) $root
Start-ManagedProcess "agent" $bun @("src/index.ts") $agent $true $agentOutputLog $agentErrorLog
Confirm-AgentReady $agentOutputLog $agentErrorLog
