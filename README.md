# Pliable

**A free, open-source direct modeler for hobbyists, makers, and students**

⚠️ **Status: Being rebuilt. Not usable yet.**

Pliable lets you shape solid geometry directly: push and pull faces, fillet and chamfer edges, and export to STEP or for 3D printing. There's no feature tree or parametric constraints to manage. It is designed for people who don't want to memorize dozens of keyboard shortcuts: tools appear based on what you've selected, every tool has a visible label and icon, and you can always search for a command by name.

## Status

Pliable started as a proof of concept built with PyQt6 and pythonocc:

![PliableDemo01](https://github.com/user-attachments/assets/d6a42c9b-c637-44f6-a5e1-b62476e6638c)

It proved that face push/pull, fillet/chamfer, and STEP round-tripping work on OpenCASCADE, but it wasn't built to scale. The project is now being rebuilt on a new architecture. The prototype is preserved as release [v0.1.0-poc](https://github.com/DesignWeaver3D/Pliable/releases/tag/v0.1.0-poc).

The code currently on `main` is still the prototype and will be replaced as the rebuild progresses.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the architecture, ordered milestones, open questions, and how to get involved.

## Planned Tech Stack

- [OpenCASCADE](https://dev.opencascade.org/) BREP kernel, via [OCP](https://github.com/CadQuery/OCP) and [build123d](https://github.com/gumyr/build123d)
- Python core for geometry, tools, and application logic
- [Three.js](https://threejs.org/) viewport
- React + TypeScript UI
- [Tauri](https://tauri.app/) desktop app, with a browser version planned

## Get Involved

Pliable is looking for frontend developers, Python/CAD developers, UX designers, and direct modeling users willing to share workflows. See [ROADMAP.md](ROADMAP.md#get-involved) for details, and open an issue to start a conversation.

## Running the Prototype

To try the original prototype, check out the release tag and use either Conda or standard Python:

    git checkout v0.1.0-poc

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

The v0.1.0-poc prototype release was published under LGPL-2.1.
