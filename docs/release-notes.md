> **Alpha software. Not for serious work. Data can be lost. The interface and behaviour will change rapidly without notice.**

Pliable is a direct-modeling CAD tool: open a STEP file, then push/pull faces, round edges, edit holes and more.

## Run it

1. Download the archive for your system and unzip it. Keep the folder together; Pliable keeps its settings and autosaves in the `data` folder beside the program, so it can run from a USB drive.
2. Run `Pliable` (`Pliable.exe` on Windows). A window opens with the app; no browser is needed.
3. Close the window to quit.

The build is **unsigned**:
- **Windows:** SmartScreen may say "Windows protected your PC". Click *More info*, then *Run anyway*. Windows 10 and 11 include the WebView2 component the window needs.
- **macOS:** Gatekeeper blocks it the first time. In Terminal run `xattr -dr com.apple.quarantine .` in the unzipped folder, then run `./Pliable`.
- **Linux:** needs Ubuntu 24.04, Mint 22 or a similar distribution from 2024 or later, with `libwebkit2gtk-4.1` installed. Run `chmod +x Pliable core/pliable` if needed, then `./Pliable`.

Only Windows has been tested by a person. The other builds passed an automated start-up check only.

## What to expect

Sketching is in the app but incomplete and unsupported. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/rebuild/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
