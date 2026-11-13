> **Alpha software. Not for serious work. Data can be lost. The interface and behavior will change rapidly without notice.**

Pliable is a direct-modeling CAD tool: open a STEP file, then push/pull faces, round edges, edit holes and more.

## Run it

1. Download the file for your system. On Windows and macOS, unzip it and keep the folder together; Pliable keeps its settings and autosaves in the `data` folder beside the program, so it can run from a USB drive. On Linux the download is a single `.AppImage` file (see below).
2. Run `Pliable` (`Pliable.exe` on Windows; on Linux, the AppImage file). A window opens with the app; no browser is needed.
3. Close the window to quit.

The build is **unsigned**:
- **Windows:** SmartScreen may say "Windows protected your PC". Click *More info*, then *Run anyway*. Windows 10 and 11 include the WebView2 component the window needs.
- **macOS:** Gatekeeper blocks it the first time. In Terminal run `xattr -dr com.apple.quarantine .` in the unzipped folder, then run `./Pliable`.
- **Linux:** needs Ubuntu 24.04, Mint 22 or a similar distribution from 2024 or later, with `libwebkit2gtk-4.1` installed. Make the downloaded file executable with `chmod +x pliable-desktop-linux-x64.AppImage`, then run `./pliable-desktop-linux-x64.AppImage`. If it says FUSE is missing, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04) or run it with `--appimage-extract-and-run`. It keeps its settings and autosaves in `~/.local/share/pliable`, not beside the file.

Only Windows has been tested by a person. The other builds passed an automated start-up check only.

## Changes in 0.4.3

- Bodies: every body is its own solid. Duplicate puts a separate copy on the original, and a tool changes only the body that owns the selection. Hidden bodies are skipped when tools merge into or cut other bodies.
- Locked bodies: a lock button next to each body's eye. No tool changes a locked body and automatic merges and cuts skip it, but its faces can still be picked as references.
- Tools that can touch other bodies have a "This body / Other bodies" setting in their card.
- Boolean has a Keep tools option that leaves the tool body in place.
- Push/Pull: Up to face, Up to last and Through all can now cut, with Subtract or Flip.
- Faces that lie on one surface stay one face after an edit: a pulled hole wall, a bore crossing a curved wall, and cylinder, cone and sphere faces the modeling kernel left split.
- Faster on large models: hover and picking, drag previews on detailed parts, and coloring a large sketch. The 3D view no longer redraws while nothing changes.
- Edges are drawn more cleanly and edges are picked more accurately in perspective view.
- macOS: keys are named Cmd and Option, and Backspace deletes.
- Fixes: Cut with plane no longer reports a miss on a tiny volume error; the degree sign is back in unit labels; an edit whose face merging failed after a fuse keeps its valid result.

## What to expect

Sketching is functional, with many improvements in this release and no known bugs. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/main/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
