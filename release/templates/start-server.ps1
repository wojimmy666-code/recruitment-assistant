param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = Join-Path $root "runtime\node.exe"
$serverRoot = Join-Path $root "server"
$serverPath = Join-Path $serverRoot "index.mjs"
$dataPath = Join-Path $root "data"
$logsPath = Join-Path $root "logs"
$pidPath = Join-Path $logsPath "server.pid"
$stdoutPath = Join-Path $logsPath "server.out.log"
$stderrPath = Join-Path $logsPath "server.error.log"
$healthUrl = "http://127.0.0.1:3218/api/health"
$appUrl = "http://localhost:3218"

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "Portable Node.js runtime is missing: $nodePath"
}
if (-not (Test-Path -LiteralPath $serverPath)) {
  throw "Server program is missing: $serverPath"
}

New-Item -ItemType Directory -Force -Path $dataPath, $logsPath | Out-Null

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($health.ok -and $health.service -eq "recruitment-assistant") {
    Write-Host "Recruitment Assistant is already running."
    if (-not $NoBrowser) { Start-Process $appUrl }
    exit 0
  }
} catch {
}

if (Get-NetTCPConnection -LocalPort 3218 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 3218 is already in use by another program."
}

if (Test-Path -LiteralPath $pidPath) {
  Remove-Item -LiteralPath $pidPath -Force
}

$oldNodeEnv = $env:NODE_ENV
$oldHost = $env:HOST
$oldPort = $env:PORT
$oldDataDir = $env:APP_DATA_DIR
$oldJournalMode = $env:DB_JOURNAL_MODE
$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = "3218"
$env:APP_DATA_DIR = $dataPath
$env:DB_JOURNAL_MODE = "DELETE"

try {
  $serverArgument = '"' + $serverPath + '"'
  $process = Start-Process -FilePath $nodePath -ArgumentList @($serverArgument) -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
} finally {
  $env:NODE_ENV = $oldNodeEnv
  $env:HOST = $oldHost
  $env:PORT = $oldPort
  $env:APP_DATA_DIR = $oldDataDir
$env:DB_JOURNAL_MODE = $oldJournalMode
}

$process.Id | Set-Content -LiteralPath $pidPath -Encoding ascii

for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    throw "Server exited during startup. Check logs\server.error.log."
  }
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.ok -and $health.service -eq "recruitment-assistant") {
      Write-Host "Recruitment Assistant started at $appUrl"
      if (-not $NoBrowser) { Start-Process $appUrl }
      exit 0
    }
  } catch {
  }
}

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
throw "Server health check timed out. Check logs\server.error.log."
