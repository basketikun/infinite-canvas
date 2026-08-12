$ErrorActionPreference = 'SilentlyContinue'

$projectDir = 'D:\应用\infinite-canvas-codex\web'
$appUrl = 'http://127.0.0.1:3000/canvas'

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
    $npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($npmCommand) {
            $npm = $npmCommand.Source
        }
    }

    if (-not (Test-Path -LiteralPath $projectDir) -or -not (Test-Path -LiteralPath $npm)) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            '找不到 Infinite Canvas 项目目录或 Node.js/npm。',
            'Infinite Canvas',
            'OK',
            'Error'
        ) | Out-Null
        exit 1
    }

    $npmCommandLine = '"' + $npm + '" run dev'
    $startArguments = @{
        FilePath         = $env:ComSpec
        WorkingDirectory = $projectDir
        ArgumentList     = @('/d', '/c', $npmCommandLine)
        WindowStyle      = 'Hidden'
    }
    Start-Process @startArguments | Out-Null

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        if (Test-InfiniteCanvas) {
            break
        }
    }
}

if (Test-InfiniteCanvas) {
    Start-Process $appUrl | Out-Null
}
else {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        'Infinite Canvas 启动超时，请检查 Node.js/npm 或项目依赖。',
        'Infinite Canvas',
        'OK',
        'Error'
    ) | Out-Null
    exit 1
}
