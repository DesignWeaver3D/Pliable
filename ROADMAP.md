# Pliable Roadmap

## Vision

Pliable is a free, open-source direct modeler designed for hobbyists, makers, students, and anyone who wants to shape solid geometry without memorizing dozens of keyboard shortcuts.

You push, pull, fillet, and reshape solids directly. There's no feature tree or parametric constraints to manage. The core use cases are quick edits to imported STEP files and fast creation of parts for 3D printing and fabrication.

**What sets Pliable apart is discoverability.** Tools appear in context based on what you've selected, every tool has a visible label and icon, and searching for a command by name always works. Keyboard shortcuts exist for speed, but nothing requires them.

## Where We Are

The original proof of concept (PyQt6 + pythonocc) is preserved as release [v0.1.0](https://github.com/DesignWeaver3D/Pliable/releases/tag/v0.1.0). It proved that face push/pull, fillet/chamfer, and STEP round-tripping work on OpenCASCADE. It wasn't built to scale.

Pliable is now being rebuilt on the architecture below. Geometry logic from the prototype will be carried over where it's useful, but the UI and interaction code are being replaced.

## Architecture

```
┌──────────────── Frontend (TypeScript) ────────────────┐
│  React UI: contextual toolbar, panels, command search │
│  Three.js viewport: rendering, picking, gizmos,       │
│  onscreen dimensions                                  │
└───────────────────────┬───────────────────────────────┘
          JSON + binary mesh messages (transport-agnostic)
          desktop: local WebSocket | browser: in-page channel
┌───────────────────────┴───────────────────────────────┐
│  Python core: document, undo history, selection,      │
│  tool registry, tools                                 │
│  build123d / OCP  →  OpenCASCADE (BREP kernel)        │
└───────────────────────────────────────────────────────┘
```

| Layer | Technology | Why |
|---|---|---|
| Geometry kernel | [OpenCASCADE](https://dev.opencascade.org/) | The only mature open-source BREP kernel |
| Python bindings | [OCP](https://github.com/CadQuery/OCP) + [build123d](https://github.com/gumyr/build123d) | Actively maintained, Pythonic, large CAD-scripting community |
| Viewport | [Three.js](https://threejs.org/) | The most widely used 3D library on the web; WebGL2 today, WebGPU ready |
| UI | React + TypeScript (Vite) | Largest frontend contributor pool; instant hot reload |
| Desktop app | [Tauri](https://tauri.app/) with a bundled Python process | Small, native-feeling installers on Windows, macOS, and Linux |
| Browser (later) | Pyodide + a WebAssembly build of OCP, or a hosted Python core | Same frontend, same protocol, different transport |

### Design principles

- **Python for everything except the kernel.** Geometry, tools, and application logic are Python and reload without compiling. OpenCASCADE is the only compiled dependency, installed prebuilt.
- **Tools are declarations, not UI code.** Each tool is a Python class that declares what selection it accepts, its typed parameters (distance, angle, count), and `preview()` / `commit()` methods. The frontend generates the toolbar entry, gizmos, onscreen dimensions, and input fields from that declaration. Adding a tool should take about 50 lines of Python.
- **Headless first.** Every tool can be tested with pytest without a UI, for example "push this face 5 mm, check the volume."
- **The protocol doesn't care about transport.** The frontend never talks to geometry directly, only through messages. That's what lets the same app run locally now and in a browser later.
- **The Python core owns all geometry.** The frontend only holds display meshes and IDs for picking.

## Milestones (ordered)

**0. Architecture Spike**
Prove the stack end to end before committing to it: a Python server and a Three.js viewer that loads a STEP file, picks a face, and push/pulls it with live preview while dragging.
*Done when:* push/pull preview feels responsive on a typical imported STEP part, and the latency is measured and written down. If it can't be made responsive, revisit the architecture before going further.

**1. Core**
The foundations every tool depends on: the document model, undo/redo history, the selection model (including keeping a selection valid across operations), the tool API, and a written protocol spec.
*Done when:* a trivial tool can be written, tested headlessly, and used from the frontend without touching any core code.

**2. Interaction Layer**
The UX that makes Pliable approachable: a contextual floating toolbar, drag gizmos, onscreen dimensions with Tab for exact entry, a command search (Ctrl+K), hover previews, and optional rebindable shortcuts. All of it is generated from tool declarations.
*Done when:* a new user can find and use every available tool without reading documentation.

**3. Direct Modeling Tools**
Port the prototype's tools first (push/pull, fillet, chamfer), then expand to the operations that matter most for editing imported geometry:
- Push/pull stretch (neighboring faces adapt instead of extruding)
- Shell / offset face
- Draft angle
- Defeature / remove face
- Uniform and directional scale

**4. Desktop Release**
Installers for Windows, macOS, and Linux via Tauri. STL and 3MF export, since many hobbyists end up at a 3D printer. This is the first release meant for real users.

**5. Placement and Transform**
A reliable way to position objects relative to faces, edges, and points, plus a move/rotate widget in the viewport.

**6. 3D Primitives**
Boxes, cylinders, spheres, and similar shapes, placed using the placement system from milestone 5.

**7. Sketching**
Sketch planes, basic constraints, and profiles for extrude, revolve, and sweep. This is the most complex milestone and will likely need an existing constraint solver rather than a new one.

**8. Browser Version**
Run Pliable in a web browser, either fully client-side through WebAssembly or with a hosted Python core.

## Open Questions

These need investigation before the milestones that depend on them:

- **Viewer reuse:** can [three-cad-viewer](https://github.com/bernhard-42/three-cad-viewer), the Three.js viewer behind the build123d/OCP VS Code extension, be reused or adapted for milestone 0? Its license and fit need checking.
- **WebAssembly feasibility:** how mature are WebAssembly builds of OCP for Pyodide, and what are the download size and performance like? This decides which path milestone 8 takes.
- **Push/pull stretch:** OpenCASCADE has no built-in "move face and let neighbors adapt" operation. It likely needs a custom algorithm, which makes it the hardest and most valuable tool in milestone 3.
- **Constraint solver:** which solver for milestone 7, and is its license compatible with AGPL-3.0?

## Future Ideas (unordered)

- User settings (later): pick radii (vertex/edge hit distance), drag threshold, highlight line widths and point sizes, navigation button mapping, and the modifier-key tool bundles. Pixel-based behavior feels different on high-DPI and large monitors, so these need to be adjustable and ideally scale with the display's pixel density.
- Plugin system (Python packages that register new tools)
- Additional import/export formats
- Performance pass
- Exporting a model's edit history as a build123d script
- Build123D scripting (very long term, undecided): a Python console or "run script" that accepts Build123D syntax to create new solids (complex arrays, parametric parts) and adds them as bodies, so Pliable needs no scripting language of its own to document. Open questions: whether it is worth building when users can already export STEP from Build123D and import it, how much of the API needs wrappers, assigning stable ids to script-made shapes, and the safety of running user code in the core.

## Get Involved

Pliable especially needs:

- **Frontend developers** (TypeScript, React, Three.js) for the viewport and interaction layer
- **Python / CAD developers** familiar with OpenCASCADE, OCP, or build123d
- **UX designers**, because approachable UX is the whole point
- **Direct modeling users** of other direct-modeling and CAD tools, even if you don't code, to share workflows and conventions

Before starting anything significant, comment on the relevant issue or open one. Signal active work with a draft PR or an issue comment to avoid parallel efforts colliding.

Pliable is licensed under [AGPL-3.0-or-later](LICENSE).
