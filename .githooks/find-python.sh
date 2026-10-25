# Sourced by the hooks: sets PY to the project's own Python, whatever is on PATH.
top="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
PY=python
for p in "$top/core/.venv/Scripts/python.exe" "$main/core/.venv/Scripts/python.exe" \
         "$top/core/.venv/bin/python" "$main/core/.venv/bin/python"; do
  if [ -x "$p" ]; then PY="$p"; break; fi
done
