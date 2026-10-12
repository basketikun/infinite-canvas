@echo off
setlocal
set "ROOT=%~dp0"

rem Let Node use the same Windows HTTPS proxy as the browser when one is configured.
if not defined HTTPS_PROXY (
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$target=[uri]'https://auth.openai.com'; $proxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($target); if ($proxy.Host -ne $target.Host) { '{0}://{1}:{2}' -f $proxy.Scheme,$proxy.Host,$proxy.Port }" 2^>nul`) do set "HTTPS_PROXY=%%P"
)
if not defined HTTP_PROXY if defined HTTPS_PROXY set "HTTP_PROXY=%HTTPS_PROXY%"
if defined HTTPS_PROXY (
    set "NODE_USE_ENV_PROXY=1"
    if defined NO_PROXY (set "NO_PROXY=%NO_PROXY%,localhost,127.0.0.1,::1") else set "NO_PROXY=localhost,127.0.0.1,::1"
)

if not exist "%ROOT%web\node_modules\.bin\vite.cmd" (
    echo Installing Infinite Canvas frontend dependencies...
    pushd "%ROOT%web"
    call npm install --legacy-peer-deps
    if errorlevel 1 goto :install_failed
    popd
)

if not exist "%ROOT%canvas-agent\node_modules\.bin\tsx.cmd" (
    echo Installing Canvas Agent dependencies...
    pushd "%ROOT%canvas-agent"
    call npm install
    if errorlevel 1 goto :install_failed
    popd
)

start "Infinite Canvas" /D "%ROOT%web" cmd /k "npm run dev"
start "Canvas Agent" /D "%ROOT%canvas-agent" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0

:install_failed
echo Dependency installation failed. Review the npm output above.
pause
exit /b 1
