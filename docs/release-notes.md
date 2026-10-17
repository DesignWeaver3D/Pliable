> **Alpha software. Not for serious work. Data can be lost. The interface and behaviour will change rapidly without notice.**

Pliable is a direct-modeling CAD tool: open a STEP file, then push/pull faces, round edges, edit holes and more.

## Run it

1. Download the archive for your system and unzip it.
2. Run `pliable` (`pliable.exe` on Windows). A console window opens, then your browser shows Pliable. Use **Chrome**; other browsers are untested.
3. Close the browser tab to quit, or press Ctrl+C in the console window.

The build is **unsigned**:
- **Windows:** SmartScreen may say "Windows protected your PC". Click *More info*, then *Run anyway*.
- **macOS:** Gatekeeper blocks it the first time. In Terminal run `xattr -dr com.apple.quarantine pliable` in the unzipped folder, then run `./pliable/pliable`.
- **Linux:** run `chmod +x pliable/pliable` if needed, then `./pliable/pliable`.

Only Windows has been tested by a person. The other builds passed an automated start-up check only.

## What to expect

Sketching is in the app but incomplete and unsupported. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/rebuild/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
