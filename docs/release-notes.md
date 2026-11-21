> **Alpha software. Not for serious work. Data can be lost. The interface and behavior will change rapidly without notice.**

Pliable is a direct-modeling CAD tool: open a STEP file, then push/pull faces, round edges, edit holes and more.

## Run it

1. Download the file for your system. On Windows, unzip it and keep the folder together; Pliable keeps its settings and autosaves in the `data` folder beside the program, so it can run from a USB drive. On macOS, unzip it and open `Pliable.app` (it can be moved to Applications); it keeps its settings and autosaves in `~/Library/Application Support/Pliable`. On Linux the download is a single `.AppImage` file (see below).
2. Run `Pliable.exe` on Windows, `Pliable.app` on macOS, or the AppImage file on Linux. A window opens with the app; no browser is needed.
3. Close the window to quit.

The build is **unsigned**:
- **Windows:** SmartScreen may say "Windows protected your PC". Click *More info*, then *Run anyway*. Windows 10 and 11 include the WebView2 component the window needs.
- **macOS:** Gatekeeper blocks it the first time, saying the app is damaged or cannot be opened. In Terminal, in the unzipped folder, run `xattr -cr Pliable.app` (it clears the download flag macOS checks), then open `Pliable.app`. If it is still blocked, open System Settings > Privacy & Security and click *Open Anyway* next to the message about Pliable; the button appears only just after a blocked launch. Both steps switch off a macOS safety check for this app, so only do them for a copy downloaded from the project's own releases page, and if you are not used to Terminal or unsure what the commands do, ask a developer you trust first.
- **Linux:** the AppImage is built on Ubuntu 22.04 and needs glibc 2.35 or newer (Ubuntu 22.04, Mint 21 or later, Debian 12 or a similar distribution). It uses the WebKitGTK (`libwebkit2gtk-4.1`) installed on the system and falls back to a copy bundled in the file when there is none; set `PLIABLE_BUNDLED_WEBKIT=1` to force the bundled copy if the system one misbehaves. Make the downloaded file executable with `chmod +x pliable-desktop-x86_64.AppImage`, then run `./pliable-desktop-x86_64.AppImage`. If it says FUSE is missing, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04) or run it with `--appimage-extract-and-run`. It keeps its settings and autosaves in `~/.local/share/pliable`, not beside the file.

Windows is the most tested. Linux Mint 22 has been used for real modeling work but not tested in full. The macOS builds are built and start-up checked automatically. One contributor has run them and reports that they work; some bugs they found are being fixed, and the architecture (Apple Silicon or Intel) is not yet recorded.

## Changes in 0.4.6

- **Linux:** the AppImage is now built on Ubuntu 22.04, so it needs glibc 2.35 or newer instead of 2.39 and starts on older distributions such as Ubuntu 22.04, Linux Mint 21 and Debian 12. Nothing else about it changes.

## What to expect

Sketching is functional, with no known bugs. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/main/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
