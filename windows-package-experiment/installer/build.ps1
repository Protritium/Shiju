param()

$ErrorActionPreference = "Stop"

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $installerDir
$offlineDir = Join-Path $root "offline-tools"
$wheelDir = Join-Path $offlineDir "wheels"
$toolsDir = Join-Path $root ".tools"
$pythonDir = Join-Path $toolsDir "python"
$python = Join-Path $pythonDir "python.exe"
$venv = Join-Path $toolsDir "build-venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
$innoDir = Join-Path $toolsDir "inno-setup"
$iscc = Join-Path $innoDir "ISCC.exe"

$pythonInstaller = Join-Path $offlineDir "python-3.12.10-amd64.exe"
$innoInstaller = Join-Path $offlineDir "inno-setup.exe"
$offlineRequirements = Join-Path $offlineDir "requirements.txt"

function Assert-FileHash([string]$path, [string]$expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "SHA-256 verification failed: $path"
    }
}

function Find-BuildPython([string]$privatePath) {
    $candidates = @($privatePath)
    $privateRoot = Split-Path -Parent $privatePath
    if (Test-Path $privateRoot) {
        $candidates += Get-ChildItem -Path $privateRoot -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    }
    if ($env:LocalAppData) {
        $candidates += (Join-Path $env:LocalAppData "Programs\Python\Python312\python.exe")
    }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base) { continue }
        foreach ($version in @("Python313", "Python312", "Python311", "Python310")) {
            $candidates += (Join-Path $base "$version\python.exe")
        }
    }
    $searchRoots = @()
    if ($env:LocalAppData) { $searchRoots += (Join-Path $env:LocalAppData "Programs\Python") }
    if ($env:ProgramFiles) { $searchRoots += (Join-Path $env:ProgramFiles "Python") }
    if (${env:ProgramFiles(x86)}) { $searchRoots += (Join-Path ${env:ProgramFiles(x86)} "Python") }
    foreach ($searchRoot in $searchRoots) {
        if (Test-Path $searchRoot) {
            $candidates += Get-ChildItem -Path $searchRoot -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
        }
    }
    $registryRoots = @(
        "HKCU:\Software\Python\PythonCore",
        "HKLM:\Software\Python\PythonCore",
        "HKLM:\Software\WOW6432Node\Python\PythonCore"
    )
    foreach ($registryRoot in $registryRoots) {
        if (-not (Test-Path $registryRoot)) { continue }
        foreach ($versionKey in Get-ChildItem $registryRoot -ErrorAction SilentlyContinue) {
            $installKey = Join-Path $versionKey.PSPath "InstallPath"
            $properties = Get-ItemProperty $installKey -ErrorAction SilentlyContinue
            if ($properties.ExecutablePath) { $candidates += $properties.ExecutablePath }
            if ($properties.'(default)') { $candidates += (Join-Path $properties.'(default)' "python.exe") }
        }
    }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not $candidate -or -not (Test-Path $candidate)) { continue }
        try {
            $validated = & $candidate -c "import sys, venv, tkinter; assert sys.version_info >= (3, 10); print(sys.executable)" 2>$null | Select-Object -Last 1
            if ($LASTEXITCODE -eq 0 -and $validated -and (Test-Path $validated)) {
                return (Resolve-Path $validated).Path
            }
        } catch {
            continue
        }
    }
    return $null
}

function Find-InnoCompiler([string]$privatePath) {
    $candidates = @($privatePath)
    if ($env:LocalAppData) {
        $candidates += (Join-Path $env:LocalAppData "Programs\Inno Setup 6\ISCC.exe")
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return (Resolve-Path $candidate).Path
        }
    }
    return $null
}

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

if (-not (Test-Path $pythonInstaller)) {
    throw "Offline Python installer is missing: $pythonInstaller"
}
if (-not (Test-Path $innoInstaller)) {
    throw "Offline Inno Setup installer is missing: $innoInstaller"
}
if (-not (Test-Path $wheelDir)) {
    throw "Offline Python wheels are missing: $wheelDir"
}
if (-not (Test-Path $offlineRequirements)) {
    throw "Offline requirements file is missing: $offlineRequirements"
}

$detectedPython = Find-BuildPython $python
if (-not $detectedPython) {
    Write-Host "[1/6] Preparing a private Python build tool..."
    Assert-FileHash $pythonInstaller "67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb"
    $pythonLog = Join-Path $toolsDir "python-install.log"
    $pythonArgs = '/quiet InstallAllUsers=0 TargetDir="{0}" PrependPath=0 Include_exe=1 Include_lib=1 Include_dev=1 Include_launcher=0 Include_shortcuts=0 Include_doc=0 Include_test=0 Include_pip=1 Include_tcltk=1 /log "{1}"' -f $pythonDir, $pythonLog
    $process = Start-Process -FilePath $pythonInstaller -ArgumentList $pythonArgs -Wait -PassThru
    for ($attempt = 0; $attempt -lt 30 -and -not $detectedPython; $attempt++) {
        $detectedPython = Find-BuildPython $python
        if (-not $detectedPython) { Start-Sleep -Milliseconds 500 }
    }
    if (@(0, 3010) -contains $process.ExitCode -and -not $detectedPython) {
        Write-Host "      An existing Python registration was found without usable files; repairing it..."
        $repairLog = Join-Path $toolsDir "python-repair.log"
        $repairArgs = '/repair /quiet /log "{0}"' -f $repairLog
        $repairProcess = Start-Process -FilePath $pythonInstaller -ArgumentList $repairArgs -Wait -PassThru
        for ($attempt = 0; $attempt -lt 60 -and -not $detectedPython; $attempt++) {
            $detectedPython = Find-BuildPython $python
            if (-not $detectedPython) { Start-Sleep -Milliseconds 500 }
        }
        if (@(0, 3010) -notcontains $repairProcess.ExitCode -or -not $detectedPython) {
            throw "Failed to repair the registered Python build tool. Exit code: $($repairProcess.ExitCode). Log: $repairLog"
        }
    }
    if (@(0, 3010) -notcontains $process.ExitCode -or -not $detectedPython) {
        throw "Failed to prepare the Python build tool. Exit code: $($process.ExitCode). Log: $pythonLog"
    }
} else {
    Write-Host "[1/6] Python build tool is ready."
}
$python = $detectedPython
Write-Host "      Using: $python"

if (-not (Test-Path $venvPython)) {
    Write-Host "[2/6] Creating an isolated build environment..."
    & $python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the build environment." }
} else {
    Write-Host "[2/6] Isolated build environment is ready."
}

Write-Host "[3/6] Installing PyInstaller from the offline bundle..."
& $venvPython -m pip install --disable-pip-version-check --no-index --find-links $wheelDir --require-hashes -r $offlineRequirements
if ($LASTEXITCODE -ne 0) { throw "Failed to install PyInstaller." }

$detectedIscc = Find-InnoCompiler $iscc
if (-not $detectedIscc) {
    Write-Host "[4/6] Preparing a private Inno Setup compiler..."
    Assert-FileHash $innoInstaller "9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732"
    $innoLog = Join-Path $toolsDir "inno-install.log"
    $innoArgs = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER /NOICONS /DIR="{0}" /LOG="{1}"' -f $innoDir, $innoLog
    $process = Start-Process -FilePath $innoInstaller -ArgumentList $innoArgs -Wait -PassThru
    $detectedIscc = Find-InnoCompiler $iscc
    if ($process.ExitCode -ne 0 -or -not $detectedIscc) {
        throw "Failed to prepare Inno Setup. Exit code: $($process.ExitCode). Log: $innoLog"
    }
} else {
    Write-Host "[4/6] Private Inno Setup compiler is ready."
}
$iscc = $detectedIscc
Write-Host "      Using: $iscc"

Write-Host "[5/6] Building the self-contained Windows application..."
Push-Location $root
try {
    & $venvPython -m PyInstaller --noconfirm --clean Shiju.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }
} finally {
    Pop-Location
}

Write-Host "[6/6] Building the one-click installer..."
$issFile = Join-Path $installerDir "Shiju.iss"
$issText = [System.IO.File]::ReadAllText($issFile)
$versionMatch = [regex]::Match($issText, '(?m)^\s*#define\s+MyAppVersion\s+"([^"]+)"')
if (-not $versionMatch.Success) { throw "MyAppVersion was not found in Shiju.iss." }
$appVersion = $versionMatch.Groups[1].Value

& $iscc $issFile
if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed." }

$output = Join-Path $root ("output\Shiju-Setup-{0}.exe" -f $appVersion)
if (-not (Test-Path $output)) { throw "The build completed but the installer was not found." }
Write-Host ""
Write-Host "Done. Give this file to Windows users:" -ForegroundColor Green
Write-Host $output -ForegroundColor Green
