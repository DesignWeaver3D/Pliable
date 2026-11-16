@echo off
rem Build the desktop app for this computer (Windows); see scripts/build.py.
cd /d "%~dp0"
set CODE=1
where uv >nul 2>nul || (echo uv is required: https://docs.astral.sh/uv 1>&2 & goto done)
uv run --project core python scripts\build.py %*
set CODE=%ERRORLEVEL%
:done
if not defined PLIABLE_NO_PAUSE pause
exit /b %CODE%
