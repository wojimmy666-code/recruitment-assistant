$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $root "logs\server.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host "Recruitment Assistant is not running."
  exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host "Removed a stale server PID file."
  exit 0
}

if ($process.ProcessName -ne "node") {
  throw "PID $serverPid does not belong to a Node.js process; refusing to stop it."
}

Stop-Process -Id $serverPid
Wait-Process -Id $serverPid -Timeout 10 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Host "Recruitment Assistant stopped."
