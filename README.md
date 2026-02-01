# Pliable

**Direct BREP modeler for rapid solid creation and editing**

⚠️ **Status: Early proof-of-concept - not usable yet**

## Goal

Build a direct solid modeling tool using OpenCASCADE. Push/pull faces to modify geometry, export to STEP.

Designed for quick geometry edits without parametric constraints.

## Development Status

**Currently building:**
- [x] pythonocc + PyQt6 setup
- [ ] Display and navigation
- [ ] Face selection
- [ ] Push/pull interaction
- [ ] STEP import/export

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
