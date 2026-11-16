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

Windows is the most tested. Linux Mint 22 has been used for real modeling work but not tested in full. The macOS builds passed an automated start-up check only; nobody has run them yet.

## Changes in 0.4.4

- **Parameters panel:** a docked panel on the right replaces every floating tool card. Push/Pull, tool forms, the Hole Editor, the Sketch card, the Section card and the measurements all live in it, under a header that names the tool. Hide or show it with its edge handle or Shift+T (while the pointer is over the 3D view); it stays hidden until you show it, covers the view without resizing it, and its width can be dragged and is remembered.
- Selecting a face fills the Push/Pull parameters, and selecting edges fills the Fillet/Chamfer form, before you start the tool.
- **Selection Information:** the names of what is selected (for example "bracket: face 12, face 14") and their measurements sit in a section at the bottom of the panel, with its own heading that hides or shows the measurements. A flat face is titled Face and shows its area.
- **One Fillet/Chamfer tool:** Constant, Variable, Per edge, Two distances, Distance and angle and Face edges (the former Round face edges) are modes of one tool, chosen with buttons above its form.
- The top bar's message line keeps errors and warnings until you read them, fades plain messages after a few seconds, and keeps its room so the search box stays put.
- **Stretch:** a new tool that stretches any solid over a local band, with a band length slider, frame and pivot picks, and fillets re-made at their radius.
- **New tools and options:** Extrude edge; Hole to slot in the Hole Editor; Join for connected sketch curves; a Copy option in Push/Pull; non-uniform scale in Scale body.
- Arrays copy a whole hole with its counterbore, countersink and thread. The Pattern hole / boss and Circular pattern tools are gone; the array tools do their work.
- **Surface bodies:** open surfaces from an import stay as surface bodies in their own Surfaces list, drawn with a darker back side, and measure by area only.
- Exact B-reps are written when exporting IFC.
- **Faster with many bodies:** drawing, picking, previews, holes right after an import, merges and the first click on a face are all quicker, because tools and merges now work only on the bodies they change. The crash backup is written shortly after your last change.
- Faces left split by an edit are merged in one step for every tool; an imported solid that came in reversed is turned round; a box select that mixes faces, edges and points shows no measurement.
- The PLIABLE tag in the top-left corner is the menu button.

## What to expect

Sketching is functional, with many improvements in this release and no known bugs. Large files, assemblies and multi-solid STEP files are best effort. See [known limitations](https://github.com/DesignWeaver3D/Pliable/blob/main/docs/known-limitations.md).

Found a problem? Click **Copy diagnostics** in the app and open an issue, attaching the STEP file if you can.
