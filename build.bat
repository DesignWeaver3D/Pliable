@echo off
rem Build the desktop app for this computer (Windows); see scripts/build.py.
rem Every prerequisite is checked first and all missing ones are listed together. build.bat --check only checks.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set CODE=1
set MISSING=0
set "NODE_URL=https://nodejs.org/en/download"
where uv >nul 2>nul
if errorlevel 1 call :need "uv: https://docs.astral.sh/uv/getting-started/installation/"
call :check_node
where cargo >nul 2>nul
if errorlevel 1 call :need "Rust: https://rustup.rs"
call :msvc_ok
if errorlevel 1 call :need "Microsoft C++ Build Tools, with Desktop development with C++: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
if "!MISSING!"=="1" (
    echo Open a new terminal after installing, so the new tools are found. 1>&2
    goto done
)
if "%~1"=="--check" (
    echo All prerequisites found.
    set CODE=0
    goto done
)
uv run --project core python scripts\build.py %*
set CODE=%ERRORLEVEL%
:done
if not defined PLIABLE_NO_PAUSE pause
exit /b %CODE%

:need
if "!MISSING!"=="0" echo Install these first, then run build.bat again: 1>&2
set MISSING=1
echo   - %~1 1>&2
exit /b 0

:check_node
where node >nul 2>nul
if errorlevel 1 (
    call :need "Node.js 20.19+ or 22.12+: !NODE_URL!"
    exit /b 0
)
set NODE_MAJOR=
set NODE_MINOR=
for /f "tokens=1,2 delims=v.-+" %%a in ('node --version 2^>nul') do (
    set NODE_MAJOR=%%a
    set NODE_MINOR=%%b
)
call :node_version_ok
if errorlevel 1 (
    call :need "Node.js 20.19+ or 22.12+ (found v!NODE_MAJOR!.!NODE_MINOR!): !NODE_URL!"
    exit /b 0
)
where npm >nul 2>nul
if errorlevel 1 call :need "npm (comes with Node.js): !NODE_URL!"
exit /b 0

:node_version_ok
if not defined NODE_MAJOR exit /b 1
if not defined NODE_MINOR exit /b 1
echo %NODE_MAJOR%.%NODE_MINOR%| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*$" >nul || exit /b 1
if !NODE_MAJOR! GEQ 23 exit /b 0
if "!NODE_MAJOR!"=="22" if !NODE_MINOR! GEQ 12 exit /b 0
if "!NODE_MAJOR!"=="20" if !NODE_MINOR! GEQ 19 exit /b 0
exit /b 1

:msvc_ok
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 1
for /f "usebackq delims=" %%p in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do exit /b 0
exit /b 1
