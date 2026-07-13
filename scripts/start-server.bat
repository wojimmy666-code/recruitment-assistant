@echo off
setlocal

pushd "%~dp0.." || (
  echo [ERROR] Cannot open the project directory.
  pause
  exit /b 1
)

title Recruitment Assistant Server

where node >nul 2>&1 || (
  echo [ERROR] Node.js is not installed or is not available in PATH.
  echo Install Node.js and run this script again.
  goto :failed
)

where npm >nul 2>&1 || (
  echo [ERROR] npm is not installed or is not available in PATH.
  goto :failed
)

if not exist "package.json" (
  echo [ERROR] package.json was not found in the project directory.
  goto :failed
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo [ERROR] Project dependencies are not installed.
  echo Run npm install in the project directory, then try again.
  goto :failed
)

echo Starting Recruitment Assistant...
echo Local URL: http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.

call npm run start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Server stopped with exit code %EXIT_CODE%.
popd
pause
exit /b %EXIT_CODE%

:failed
popd
pause
exit /b 1
