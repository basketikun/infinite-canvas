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
            if ($config.ok -and $config.protocolVersion -eq 7) { return }
            $lastError = "Canvas Agent started with protocol v$($config.protocolVersion), but this page requires v7."
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
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$viteCommand = 'cd /d "' + $web + '" && bun run dev'
Start-ManagedProcess "vite" $env:ComSpec @("/d", "/c", $viteCommand) $root
Start-ManagedProcess "agent" $npx @("--yes", "@basketikun/canvas-agent@latest") $root $true $agentOutputLog $agentErrorLog
Confirm-AgentReady $agentOutputLog $agentErrorLog
