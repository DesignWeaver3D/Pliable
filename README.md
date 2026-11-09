# Pliable

**A free, open-source direct modeler built on professional-grade solid geometry**

> ⚠️ **Alpha software.** The interface and behavior will change rapidly without notice, saved `.plbl` files may not open in later versions, and application instability can cause crashes and lost work. See [known limitations](docs/known-limitations.md). Report problems with the [bug report template](https://github.com/DesignWeaver3D/Pliable/issues/new?template=bug_report.md) (use **Copy diagnostics** in the app).

Pliable lets you shape solid geometry directly: push and pull faces, fillet and chamfer edges, and export to STEP or for 3D printing. There's no feature tree or parametric constraints to manage. Every tool is discoverable: tools appear based on what you've selected, each has a visible label and icon, and you can always search for a command by name.

## What Pliable is, and isn't

Pliable is a free, open-source direct modeler. You shape solid geometry directly, with no feature tree to manage, and sketch with constraint-driven, dimensioned profiles. It is built on the OpenCASCADE kernel, so the bodies it produces are exact BREP solids that export to STEP for use in any other CAD package or ecosystem. Its aim is a simplified, fully discoverable interface with a deliberately narrow scope, covering the base level of 3D design that most everyday CAD work needs. It suits hobbyists, makers and students, and is meant to be usable by professionals as well.

**Where it sits.** Pliable aims to be more capable than beginner block-modeling tools such as TinkerCAD, without attempting full product lifecycle development. Its workflow is inspired by the direct-modeling approaches of Plasticity, Rhino, and Solid Edge's Synchronous Technology (design intent). Pliable is an independent project. It does not claim equivalence or parity with any other software, commercial or open source. It is also meant to work beside FreeCAD, not replace it: FreeCAD offers a parametric workflow, and Pliable offers a direct-modeling one that complements it.

**Principles**

- **Fully discoverable.** Every task can be done without memorized hotkeys. Tools appear based on your selection, each with a visible label and icon.
- **Hotkeys only where they earn it.** They are limited to core, frequent tasks. Constraining sketches is one example. Search (`/`) is a convenience, never a required step.
- **No workbenches.** Pliable does not use the workbench paradigm. Sketching is its own workspace, with its own rules and hotkeys, and the aim is to make moving between sketching and modeling as seamless as possible.
- **Local and portable.** Pliable runs on your own computer with no cloud requirement and no account. It needs no full operating-system installation: unzip it and run it. The goal is that it runs the same way on Windows, macOS and Linux.
- **Narrow scope.** Multiple solid bodies allow static assemblies. Motion simulation, technical drawings, FEM, CFD and CAM are out of scope. Export a STEP file and continue in FreeCAD or another suite.

**Why a standalone app.** Pliable began as a proof of concept on pythonocc and was rebuilt on OCP and build123d. It is not a FreeCAD workbench, partly in the hope that avoiding FreeCAD's 3D view layer and topological system would improve performance. In practice the bottleneck is OpenCASCADE itself. The frontend is slightly faster and more fluid, but not by enough to claim a performance advantage. The value of Pliable is its workflow, not its computational speed.

## Status

Pliable started as a proof of concept built with PyQt6 and pythonocc:

![PliableDemo01](https://github.com/user-attachments/assets/d6a42c9b-c637-44f6-a5e1-b62476e6638c)

It proved that face push/pull, fillet/chamfer, and STEP round-tripping work on OpenCASCADE, but it wasn't built to scale. The project is now being rebuilt on a new architecture. The prototype is preserved as release [v0.1.0](https://github.com/DesignWeaver3D/Pliable/releases/tag/v0.1.0).

`main` holds the rebuild; the latest release is [v0.4.2](https://github.com/DesignWeaver3D/Pliable/releases/tag/v0.4.2). The prototype lives on at the `v0.1.0` tag.

## Download and run

Get the archive for your system from the [releases page](https://github.com/DesignWeaver3D/Pliable/releases), unzip it and run `Pliable` (`Pliable.exe` on Windows). A window opens with the app; there is nothing to install. Everything Pliable saves (settings, autosaves, a core log) goes in the `data` folder beside the program, so it can run from a USB drive. The builds are unsigned, so Windows and macOS will warn on first launch; the [release notes](docs/release-notes.md) say what to click. Linux needs Ubuntu 24.04, Linux Mint 22 or a similar distribution from 2024 or later, with `libwebkit2gtk-4.1`. Only Windows has been tested by a person so far; see [known limitations](docs/known-limitations.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the architecture, ordered milestones, open questions, and how to get involved.

## Tech Stack

- [OpenCASCADE](https://dev.opencascade.org/) BREP kernel, via [OCP](https://github.com/CadQuery/OCP) and [build123d](https://github.com/gumyr/build123d)
- Python core for geometry, tools, and application logic
- [Three.js](https://threejs.org/) viewport
- React + TypeScript UI
- [Tauri](https://tauri.app/) desktop shell (a native window around the app, started with the packaged Python core); a browser version is planned

## Get Involved

Pliable is looking for frontend developers, Python/CAD developers, UX designers, and direct modeling users willing to share workflows. See [ROADMAP.md](ROADMAP.md#get-involved) for details, and open an issue to start a conversation.

## Running from source

Requires [uv](https://docs.astral.sh/uv/) and Node 24.

    cd core
    uv sync
    uv run pytest                # optional: run the tests
    uv run pliable-server        # ws://127.0.0.1:8765

    cd app
    npm install
    npm run dev                  # http://localhost:5173, needs the server running

Open the page (Chrome is the browser used for development), pick a demo or import a STEP file, and try:

- **Select:** click a face, edge or vertex (Ctrl+click to add to the selection).
- **Push/pull a face:** drag it. **Fillet/chamfer an edge:** drag it outward (fillet) or inward (chamfer).
- **Exact values:** type a number during a drag, Enter to commit, Escape to cancel.
- **Tools:** the toolbar shows what applies to the selection; / searches all commands.
- **Navigate:** wheel zooms, right-drag orbits, middle-drag pans. The cube at the top right (or keys **0** iso, **1** front, **2** top, **3** right, **4** rear, **5** bottom, **6** left) sets the view; **P** toggles perspective/orthographic; **V** looks straight at the selected flat face.
- **All tools:** the list at the left holds every tool (grouped in `app/src/layout.ts`); tools without a drag open a form with live preview. **Edit last** undoes the newest operation and reopens its form.
- **Related faces:** selecting a face highlights related ones (coplanar, equal radius, coaxial); the chips at the bottom switch each rule on or off. Push/pull and the hole tools act on the matches too.
- **Sketch:** "Sketch on selected face" or on XY/XZ/YZ (bottom bar). Draw lines, rectangles, circles and arcs; select items to add constraints and dimensions (solved by SolveSpace); then extrude (join or cut, one or both directions) or revolve about a line.
- **Model info:** validity, counts, volume and size. **Combine STEP:** union, cut or intersect with another file.
- **Developer metrics:** add `?dev=1` to the page address to show triangle counts and timings.
- **Undo/redo:** Ctrl+Z / Ctrl+Y. **Export:** STEP button.

To build the desktop app yourself, see the Desktop shell section of [CONTRIBUTING.md](CONTRIBUTING.md).

## Running the Prototype

To try the original prototype, check out the release tag and use either Conda or standard Python:

    git checkout v0.1.0

**Option A: Conda (recommended on Windows/macOS).** This is the most reliable way to install `pythonocc-core`.

    conda env create -f environment.yml
    conda activate pliable
    python pliable.py

**Option B: Standard Python.**

    python -m venv venv
    venv\Scripts\activate        # Windows
    source venv/bin/activate     # macOS/Linux

    pip install -r requirements.txt
    python pliable.py

> Note: `pythonocc-core` may not be available via pip on some platforms. If installation fails, use Conda.

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The v0.1.0 prototype release was published under LGPL-2.1.

---

*All product names, trademarks and registered trademarks mentioned in this document, including but not limited to TinkerCAD, Plasticity, Rhino, Solid Edge, Synchronous Technology, Blender and FreeCAD, are the property of their respective owners. They are used only to describe how Pliable relates to other software. Pliable is not affiliated with, endorsed by, or sponsored by any of them. Any other trademarks not listed here belong to their respective owners.*
