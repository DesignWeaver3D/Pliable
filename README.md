# Pliable

**Direct BREP modeler for rapid solid creation and editing**

⚠️ **Status: Early proof-of-concept - not usable yet**

## Goal

Build a direct solid modeling tool using OpenCASCADE. Push/pull faces to modify geometry, export to STEP.

Designed for quick geometry edits without parametric constraints.

## Development Status

**Currently building:**
- [x] pythonocc + PyQt6 setup
- [x] Display primitive cube and navigation
- [x] Face selection with cyan highlighting
- [x] Push/pull interaction
- [x] Main window
- [x] STEP import/export
- [x] Add edge & vertex selection
- [x] Add message panel for user feedback
- [x] Fillet/Chamfer edge interaction
- [ ] Undo with history of shapes
- [ ] Dimension overlay for interactions

## Tech Stack

- Python 3.12
- [pythonocc-core](https://github.com/tpaviot/pythonocc-core) (OpenCASCADE BREP kernel)
- PyQt6

## Installation (Not Ready Yet)
```bash
conda env create -f environment.yml
conda activate pliable
python pliable.py
```

## License

LGPL v2.1
