$ErrorActionPreference = 'Stop'

$projectDir = 'D:\应用\infinite-canvas-codex\web'
$appUrl = 'http://127.0.0.1:3000/canvas'
$logDir = Join-Path $env:LOCALAPPDATA 'InfiniteCanvas'
$stdoutLog = Join-Path $logDir 'startup.stdout.log'
$stderrLog = Join-Path $logDir 'startup.stderr.log'
$startupError = $null

function Test-InfiniteCanvas {
    try {
        $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 1
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

if (-not (Test-InfiniteCanvas)) {
    try {
        $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
        if (-not (Test-Path -LiteralPath $npm)) {
            $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if ($npmCommand) {
                $npm = $npmCommand.Source
            }
        }

        if (-not (Test-Path -LiteralPath $projectDir) -or -not (Test-Path -LiteralPath $npm)) {
            throw '找不到 Infinite Canvas 项目目录或 Node.js/npm。'
        }

        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
        $npmCommandLine = 'call "' + $npm + '" run dev'
        $startArguments = @{
            FilePath               = $env:ComSpec
            WorkingDirectory       = $projectDir
            ArgumentList           = @('/d', '/c', $npmCommandLine)
            RedirectStandardOutput = $stdoutLog
            RedirectStandardError  = $stderrLog
            WindowStyle            = 'Hidden'
            PassThru                = $true
        }
        $devProcess = Start-Process @startArguments

        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 1
            if (Test-InfiniteCanvas) {
                break
            }
            if ($devProcess.HasExited) {
                break
            }
        }

        if (-not (Test-InfiniteCanvas)) {
            $output = @(
                if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Tail 12 }
                if (Test-Path -LiteralPath $stdoutLog) { Get-Content -LiteralPath $stdoutLog -Tail 12 }
            ) -join [Environment]::NewLine
            if ($output) {
                $startupError = "启动输出：`n$output"
            }
        }
    }
    catch {
        $startupError = $_.Exception.Message
    }
}

if (Test-InfiniteCanvas) {
    Start-Process $appUrl | Out-Null
}
else {
    Add-Type -AssemblyName PresentationFramework
    $details = if ($startupError) { "`n`n$startupError" } else { '' }
    [System.Windows.MessageBox]::Show(
        "Infinite Canvas 启动超时，请检查 Node.js/npm 或项目依赖。$details`n`n详细日志：$stderrLog",
        'Infinite Canvas',
        'OK',
        'Error'
    ) | Out-Null
    exit 1
}
