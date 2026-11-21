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

## Changes in 0.4.5

- **Linux:** the AppImage now carries its own copy of WebKitGTK and uses it only when the system has none, so it starts on a system without `libwebkit2gtk-4.1`. Where the system has it, nothing changes. The file is now named `pliable-desktop-x86_64.AppImage`.
- **Quitting asks first:** closing the window or quitting the desktop app with unsaved work asks "Quit without saving?" with Quit and Cancel, as the browser does when a tab is closed. Unsaved means an open sketch, or edits since the project was last saved; right after Save project it does not ask. On macOS the Quit menu item asks the same question.
- **Stopping the program from outside:** on macOS and Linux, a termination signal (for example from a task manager or a shutdown) now stops the geometry core with the window instead of leaving it running.
- **Saving files on macOS and Linux:** each file saved from the page waits for its Save As dialog in a folder of its own, so a program killed in the middle of a save no longer leaves a file that makes every later save of that name do nothing.
- **A page freeze fixed:** an unread orange warning from a sketch followed by a plain sketch message no longer freezes the whole page.
- **Construction curves:** a selected, highlighted or hovered construction curve stays dashed, so toggling construction on a selected curve now shows the change.
- **Safer:** the core accepts a connection only from this computer's own pages, so a web page open in your browser can no longer send requests to a running core.
- **macOS:** the download is now `Pliable.app` (unzip and open it; it keeps its data in `~/Library/Application Support/Pliable`) instead of a folder with a bare program that opened a Terminal window.
- **For diagnosis:** when a core request runs over 30 seconds, every thread's stack is written once to `core.log` in the data folder.

## What to expect

Sketching is functional, with no known bugs. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/main/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
