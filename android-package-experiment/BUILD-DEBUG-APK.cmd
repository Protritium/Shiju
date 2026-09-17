@echo off
setlocal
pushd "%~dp0"
if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  echo Android SDK was not found.
  echo Open this folder in Android Studio once, or set ANDROID_HOME.
  pause
  exit /b 1
)
call gradlew.bat --no-daemon assembleDebug
if errorlevel 1 (
  echo.
  echo APK build failed. Review the error above.
  pause
  exit /b 1
)
echo.
echo APK created:
echo %CD%\app\build\outputs\apk\debug\app-debug.apk
pause
popd
