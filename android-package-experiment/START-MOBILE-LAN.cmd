@echo off
setlocal
pushd "%~dp0"
where py >nul 2>nul || (
  echo Python was not found on this computer.
  pause
  exit /b 1
)
py -3 start_mobile_lan.py
popd
