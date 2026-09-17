@echo off
setlocal
pushd "%~dp0"
if exist ".tools\python\python.exe" (
  ".tools\python\python.exe" app\windows_launcher.py
) else (
  where py >nul 2>nul || (
    echo Build tools are not ready. Run installer\build.cmd first.
    pause
    exit /b 1
  )
  py -3 app\windows_launcher.py
)
popd
