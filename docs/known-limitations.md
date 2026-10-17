# Known limitations (alpha)

> Alpha software. Not for serious work. Data can be lost. The interface and behaviour will change rapidly without notice.

## What the alpha promises

- Runs on Windows. Only Windows has been tested; macOS and Linux are untested until testers there confirm.
- Opens and exports STEP.
- Applies the direct-editing tools to single parts of modest size.
- Autosaves your work and offers to restore it after a crash.

## Best effort

- STEP files from other CAD programs. Please attach failing files to a bug report.
- Large files. Keep STEP files under roughly 10 MB. Files up to about 27 MB (8,000+ faces) have been opened successfully, but editing them is untested beyond a few operations and can be slow or fail.
- Multi-solid files and assemblies. Tools act on the solid you select, but solids cannot be hidden yet, so features covered by other solids cannot be reached. Stacked or overlapping solids can also make operations fail. Pliable shows a notice when you open such a file.
- Units other than millimetres.
- Surface bodies that cannot be closed on import stay in the model as open surfaces; tools cannot add material there. The import warning lists each one with its number of open loops and how many are flat.

## Not promised

- **Sketching is incomplete and unsupported.** It is in the app but expect missing features and failures.
- Performance and UI stability.
- Compatibility of anything saved by this version with later versions. Export STEP to keep your work.
- **Chrome only.** Other browsers are untested.
- Autosave protects against crashes, not against a bad edit. Undo history is capped at 50 steps.
- The portable build is unsigned, so Windows SmartScreen will warn on first launch.

- **The 3D view is an approximation of the exact solid.** Curves and cylinders are drawn as small flat facets, and the facets are coarser while you drag. The underlying model and STEP export are exact.

## Reporting problems

Open an issue using the bug report template. Click **Copy diagnostics** in the app first; it shows exactly what will be copied (versions, recent log lines, the last tool run) and contains no model data, file paths or personal details.
