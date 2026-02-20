# Pliable

**Direct BREP modeler for rapid solid creation and editing**

⚠️ **Status: Early proof-of-concept - not usable yet**

![PliableDemo01](https://github.com/user-attachments/assets/d6a42c9b-c637-44f6-a5e1-b62476e6638c)


## Goal

Build a direct solid modeling tool using OpenCASCADE. Push/pull faces to modify geometry, export to STEP.

Designed for quick geometry edits without parametric constraints.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned milestones and how to get involved.

## Development Status

**Currently implemented:**
- [x] pythonocc + PyQt6 setup
- [x] Display primitive cube and navigation
- [x] Face selection with cyan highlighting
- [x] Push/pull interaction - shift+left-drag to additive or subtractive extrude a face
- [x] Main window
- [x] STEP import/export
- [x] Edge & vertex selection
- [x] Message panel for user feedback
- [x] Fillet/Chamfer edge interaction - shift+left-drag away from model for fillet, toward for chamfer
- [x] Undo with history of shapes
- [x] Popup for manual push-pull dimension entry

## Tech Stack

- Python 3.12
- [pythonocc-core](https://github.com/tpaviot/pythonocc-core) (OpenCASCADE BREP kernel)
- PyQt6

## Installation (Development)

Pliable is in an early proof‑of‑concept stage. You can run it from source using either Conda or standard Python.

### **Option A — Conda (recommended on Windows/macOS)**

This provides the most reliable installation of `pythonocc-core`.

    conda env create -f environment.yml
    conda activate pliable
    python pliable.py

### **Option B — Standard Python (venv/pyenv/Poetry)**

If you prefer not to use Conda:

    python -m venv venv
    venv\Scripts\activate        # Windows
    source venv/bin/activate     # macOS/Linux

    pip install -r requirements.txt
    python pliable.py

> Note: On some platforms, `pythonocc-core` may not be available via pip.  
> If installation fails, use the Conda method above.

## License

LGPL v2.1
