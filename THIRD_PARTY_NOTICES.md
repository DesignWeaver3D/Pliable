# Third-party notices

Pliable is licensed under the GNU Affero General Public License v3 or later (see [LICENSE](LICENSE)). It uses the following components, each under its own license. Check each project for the authoritative terms.

| Component | Use | License |
|---|---|---|
| [OpenCASCADE Technology](https://dev.opencascade.org/) | BREP geometry kernel | LGPL-2.1 with the OCCT exception |
| [OCP](https://github.com/CadQuery/OCP) (CadQuery) | Python bindings for OpenCASCADE | Apache-2.0 |
| [build123d](https://github.com/gumyr/build123d) | CAD helpers on top of OCP | Apache-2.0 |
| [py-slvs](https://github.com/realthunder/slvs_py) (SolveSpace solver) | Sketch constraint solver | GPL-3.0 |
| [websockets](https://github.com/python-websockets/websockets) | Core to browser connection | BSD-3-Clause |
| [rhino3dm](https://github.com/mcneel/rhino3dm) | Reads and writes .3dm files | MIT |
| [IfcOpenShell](https://ifcopenshell.org/) | Reads .ifc files (optional `ifc` extra, also used by the tests) | LGPL-3.0-or-later |
| IfcOpenShell's Python dependencies: [shapely](https://github.com/shapely/shapely), [lark](https://github.com/lark-parser/lark), [isodate](https://github.com/gweis/isodate), [python-dateutil](https://github.com/dateutil/dateutil), [six](https://github.com/benjaminp/six), [tzdata](https://github.com/python/tzdata) | Support libraries for the .ifc reader | BSD-3-Clause, MIT, BSD, BSD, MIT, Apache-2.0 |
| [Three.js](https://threejs.org/) | Viewport | MIT |
| [Vite](https://vite.dev/) and TypeScript | Frontend build (not shipped in the page) | MIT / Apache-2.0 |
| [Tauri](https://tauri.app/) with WRY and TAO | Desktop window around the app | MIT OR Apache-2.0 |
| [PyInstaller](https://pyinstaller.org/) | Freezes the Python core for the portable build (a build tool; its bootloader is part of the build) | GPL-2.0-or-later with an exception that allows any program to be bundled |
| About 400 Rust crates used by the desktop shell | Window, webview and system access (the full list is in `desktop/src-tauri/Cargo.lock`) | Mostly MIT or Apache-2.0; also Unicode-3.0, Zlib, ISC, BSD-3-Clause and MPL-2.0 (a few crates) |

The desktop window uses the operating system's webview (Microsoft WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux); it is not bundled. Portable builds bundle the other components. OpenCASCADE is LGPL: its libraries ship as separate files in the build so they can be replaced. The AGPL source for Pliable is at https://github.com/DesignWeaver3D/Pliable.

<!-- lock fingerprints: desktop/src-tauri/Cargo.lock=0acc4fc288cc core/uv.lock=d3510d26c44c app/package-lock.json=e7dd29074a56 desktop/package-lock.json=01a653602ff9 -->
