# Known limitations (alpha)

> Alpha software. Not for serious work. Data can be lost. The interface and behavior will change rapidly without notice.

## What the alpha promises

- Runs as a portable desktop app (a native window; no browser needed). Only Windows has been tested by a person. The macOS and Linux builds are built and start-up checked automatically, but nobody has opened their window yet; testers there are welcome.
- Opens and exports STEP.
- Applies the direct-editing tools to single parts of modest size.
- Autosaves your work and offers to restore it after a crash.

## Best effort

- STEP files from other CAD programs. Please attach failing files to a bug report.
- Large files. Keep STEP files under roughly 10 MB. Files up to about 27 MB (8,000+ faces) have been opened successfully, but editing them is untested beyond a few operations and can be slow or fail.
- Multi-solid files and assemblies. Tools act on the solid you select; use See-through or Focus in the bodies list to reach features that other solids cover. Stacked or overlapping solids can also make operations fail. Pliable shows a notice when you open such a file.
- Units other than millimeters.
- Surface bodies that cannot be closed on import stay in the model as open surfaces; tools cannot add material there. The import warning lists each one with its number of open loops and how many are flat.

## Not promised

- **Sketching is incomplete and unsupported.** It is in the app but expect missing features and failures.
- Performance and UI stability.
- Compatibility of anything saved by this version with later versions. Export STEP to keep your work.
- **Webview differences.** The window uses the system webview: WebView2 on Windows (Chromium-based, the tested one), WebKit on macOS and WebKitGTK on Linux. Drawing, fonts and file dialogs may differ on the last two. Running the core in a browser is a development setup, and Chrome is the only browser tried.
- Autosave protects against crashes, not against a bad edit. Undo history is capped at 50 steps.
- The portable builds are unsigned: Windows SmartScreen warns on first launch and macOS Gatekeeper blocks it until you allow it (see the release notes). Linux needs Ubuntu 24.04, Linux Mint 22 or a similar distribution from 2024 or later with `libwebkit2gtk-4.1`.
- Everything Pliable saves lives in the `data` folder beside the program. Moving the folder keeps your settings and autosaves; deleting it resets them.

- **The 3D view is an approximation of the exact solid.** Curves and cylinders are drawn as small flat facets, and the facets are coarser while you drag. The underlying model and STEP export are exact.

## Tool-usage counts

Pliable counts, on your computer only, how often each tool is started, committed, cancelled or fails, and where it was started from (tool strip, search, tool list, keyboard, direct drag). Only tool names and counts are kept, in memory until the core stops; no model data, file names or personal details. The counts leave your computer only if you copy the diagnostics report yourself (they are listed in its preview, and **Clear usage counts** resets them). They are used to plan the interface.

## Reporting problems

Open an issue using the bug report template. Click **Copy diagnostics** in the app first; it shows exactly what will be copied (versions, recent log lines, the last tool run, tool-usage counts) and contains no model data, file paths or personal details.
