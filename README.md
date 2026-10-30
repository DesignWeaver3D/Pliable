# Pliable

**A free, open-source direct modeler for hobbyists, makers, and students**

> ⚠️ **Alpha software. Not for serious work. Data can be lost. The interface and behavior will change rapidly without notice.**
> Sketching is incomplete and unsupported. See [known limitations](docs/known-limitations.md). Report problems with the [bug report template](https://github.com/DesignWeaver3D/Pliable/issues/new?template=bug_report.md) (use **Copy diagnostics** in the app). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

⚠️ **Status: Alpha software, rebuilt on a new architecture. The current alpha is v0.4.0, a portable desktop app; expect rough edges.**

Pliable lets you shape solid geometry directly: push and pull faces, fillet and chamfer edges, and export to STEP or for 3D printing. There's no feature tree or parametric constraints to manage. It is designed for people who don't want to memorize dozens of keyboard shortcuts: tools appear based on what you've selected, every tool has a visible label and icon, and you can always search for a command by name.

## Status

Pliable started as a proof of concept built with PyQt6 and pythonocc:

![PliableDemo01](https://github.com/user-attachments/assets/d6a42c9b-c637-44f6-a5e1-b62476e6638c)

It proved that face push/pull, fillet/chamfer, and STEP round-tripping work on OpenCASCADE, but it wasn't built to scale. The project is now being rebuilt on a new architecture. The prototype is preserved as release [v0.1.0](https://github.com/DesignWeaver3D/Pliable/releases/tag/v0.1.0).

`main` holds the last released rebuild. The prototype lives on at the `v0.1.0` tag.

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

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE).

The v0.1.0 prototype release was published under LGPL-2.1.
