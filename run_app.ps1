$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$BackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8000 }
$FrontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 4173 }
$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "0.0.0.0" }
$FrontendDir = Join-Path $RepoRoot 'frontend'

# Start backend
$backendArgs = @('-m','uvicorn','backend.main:app','--host', $BackendHost,'--port', $BackendPort,'--reload')
$backend = Start-Process -FilePath "python" -ArgumentList $backendArgs -PassThru -WindowStyle Hidden -WorkingDirectory $RepoRoot
Write-Host "Backend running on http://$BackendHost:$BackendPort" -ForegroundColor Green

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList @("install") -Wait -WorkingDirectory $FrontendDir
}

$env:BACKEND_URL = "http://$BackendHost:$BackendPort"
$null = Start-Process -FilePath "npm" -ArgumentList @("run","build") -Wait -WorkingDirectory $FrontendDir
$env:PORT = $FrontendPort
$frontendArgs = @("run","preview","--","--host","--port",$FrontendPort)
$frontend = Start-Process -FilePath "npm" -ArgumentList $frontendArgs -PassThru -WindowStyle Hidden -WorkingDirectory $FrontendDir
Write-Host "Frontend (Vite preview) running on http://localhost:$FrontendPort" -ForegroundColor Green

Write-Host "Press Ctrl+C to stop both." -ForegroundColor Cyan

try {
    Wait-Process -Id @($backend.Id, $frontend.Id)
}
finally {
    if ($backend -and !$backend.HasExited) { Stop-Process -Id $backend.Id -Force }
    if ($frontend -and !$frontend.HasExited) { Stop-Process -Id $frontend.Id -Force }
}
