# Sourced by the hooks: sets PY to the project's own Python, whatever is on PATH.
# Only this system's kind of program is tried, so a virtual environment made on another system is never run.
top="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
PY=python
if command -v python3 >/dev/null 2>&1; then PY=python3; fi
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) venv_python=Scripts/python.exe ;;
  *) venv_python=bin/python ;;
esac
for p in "$top/core/.venv/$venv_python" "$main/core/.venv/$venv_python"; do
  if [ -x "$p" ]; then PY="$p"; break; fi
done
