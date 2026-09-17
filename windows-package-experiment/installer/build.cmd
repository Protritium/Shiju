@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
if errorlevel 1 (
  echo.
  echo Build failed. Review the error above, then press any key.
  pause >nul
) else (
  echo.
  echo Build completed successfully. Press any key.
  pause >nul
)
