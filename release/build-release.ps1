[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$releaseRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $releaseRoot
$manifest = Get-Content (Join-Path $projectRoot "extension\manifest.json") -Raw | ConvertFrom-Json
$version = [string]$manifest.version
$packageName = "recruitment-assistant-win-x64"
$outputRoot = Join-Path $releaseRoot $packageName
$archivePath = Join-Path $releaseRoot "$packageName-v$version.zip"
$checksumPath = Join-Path $releaseRoot "$packageName-v$version.sha256"
$cacheRoot = Join-Path $releaseRoot ".cache"
$nodeVersion = "20.17.0"
$nodePackage = "node-v$nodeVersion-win-x64"
$nodeArchive = Join-Path $cacheRoot "$nodePackage.zip"
$nodeDownloadUrl = "https://nodejs.org/dist/v$nodeVersion/$nodePackage.zip"
$nodeExtractRoot = Join-Path $cacheRoot "node"

function Assert-SafeReleasePath([string]$Path) {
  $releaseFullPath = [IO.Path]::GetFullPath($releaseRoot).TrimEnd("\") + "\"
  $targetFullPath = [IO.Path]::GetFullPath($Path)
  if (-not $targetFullPath.StartsWith($releaseFullPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the release directory: $targetFullPath"
  }
}

function Remove-ReleaseItem([string]$Path) {
  Assert-SafeReleasePath $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Command failed with exit code $($process.ExitCode): $FilePath"
  }
}

Write-Host "Building Recruitment Assistant v$version..." -ForegroundColor Cyan

Remove-ReleaseItem $outputRoot
Remove-ReleaseItem $archivePath
Remove-ReleaseItem $checksumPath
New-Item -ItemType Directory -Force -Path $outputRoot, $cacheRoot | Out-Null

Invoke-Checked "npm.cmd" @("run", "build") $projectRoot
Invoke-Checked "npm.cmd" @("run", "build:server") $projectRoot

$serverRoot = Join-Path $outputRoot "server"
$runtimeRoot = Join-Path $outputRoot "runtime"
$extensionRoot = Join-Path $outputRoot "chrome-extension"
New-Item -ItemType Directory -Force -Path $serverRoot, $runtimeRoot, $extensionRoot | Out-Null

Copy-Item (Join-Path $projectRoot "build\server\index.mjs") (Join-Path $serverRoot "index.mjs")
Copy-Item (Join-Path $projectRoot "dist") (Join-Path $serverRoot "dist") -Recurse
Copy-Item (Join-Path $projectRoot "package.json") (Join-Path $serverRoot "package.json")
Copy-Item (Join-Path $projectRoot "package-lock.json") (Join-Path $serverRoot "package-lock.json")

$previousSkipBrowserDownload = $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
try {
  Invoke-Checked "npm.cmd" @("ci", "--omit=dev", "--no-audit", "--no-fund") $serverRoot
} finally {
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $previousSkipBrowserDownload
}

Copy-Item (Join-Path $projectRoot "extension\*") $extensionRoot -Recurse

if (-not (Test-Path -LiteralPath $nodeArchive)) {
  Write-Host "Downloading portable Node.js $nodeVersion..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $nodeDownloadUrl -OutFile $nodeArchive
}

Remove-ReleaseItem $nodeExtractRoot
New-Item -ItemType Directory -Force -Path $nodeExtractRoot | Out-Null
Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtractRoot -Force
$nodeSourceRoot = Join-Path $nodeExtractRoot $nodePackage
Copy-Item (Join-Path $nodeSourceRoot "node.exe") (Join-Path $runtimeRoot "node.exe")
Copy-Item (Join-Path $nodeSourceRoot "LICENSE") (Join-Path $runtimeRoot "NODE-LICENSE.txt")

Copy-Item (Join-Path $releaseRoot "templates\start-server.bat") (Join-Path $outputRoot "start-server.bat")
Copy-Item (Join-Path $releaseRoot "templates\stop-server.bat") (Join-Path $outputRoot "stop-server.bat")
Copy-Item (Join-Path $releaseRoot "templates\start-server.ps1") (Join-Path $outputRoot "start-server.ps1")
Copy-Item (Join-Path $releaseRoot "templates\stop-server.ps1") (Join-Path $outputRoot "stop-server.ps1")
Copy-Item (Join-Path $releaseRoot "templates\USAGE.txt") (Join-Path $outputRoot "README.txt")

New-Item -ItemType Directory -Force -Path (Join-Path $outputRoot "data"), (Join-Path $outputRoot "logs") | Out-Null
Set-Content -LiteralPath (Join-Path $outputRoot "data\.keep") -Value "" -Encoding ascii
Set-Content -LiteralPath (Join-Path $outputRoot "logs\.keep") -Value "" -Encoding ascii

$versionInfo = [ordered]@{
  name = "Recruitment Assistant"
  version = $version
  platform = "win32-x64"
  node = $nodeVersion
  builtAt = (Get-Date).ToUniversalTime().ToString("o")
}
$versionInfo | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot "version.json") -Encoding utf8

Remove-ReleaseItem $nodeExtractRoot

Write-Host "Creating archive..." -ForegroundColor Cyan
Compress-Archive -Path $outputRoot -DestinationPath $archivePath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Host ""
Write-Host "Release ready:" -ForegroundColor Green
Write-Host "  Directory: $outputRoot"
Write-Host "  Archive:   $archivePath"
Write-Host "  SHA256:    $hash"

