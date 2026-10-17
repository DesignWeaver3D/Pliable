# Third-party notices

Pliable is licensed under the GNU Affero General Public License v3 or later (see [LICENSE](LICENSE)). It uses the following components, each under its own license. Check each project for the authoritative terms.

| Component | Use | License |
|---|---|---|
| [OpenCASCADE Technology](https://dev.opencascade.org/) | BREP geometry kernel | LGPL-2.1 with the OCCT exception |
| [OCP](https://github.com/CadQuery/OCP) (CadQuery) | Python bindings for OpenCASCADE | Apache-2.0 |
| [build123d](https://github.com/gumyr/build123d) | CAD helpers on top of OCP | Apache-2.0 |
| [py-slvs](https://github.com/realthunder/slvs_py) (SolveSpace solver) | Sketch constraint solver | GPL-3.0 |
| [websockets](https://github.com/python-websockets/websockets) | Core to browser connection | BSD-3-Clause |
| [Three.js](https://threejs.org/) | Viewport | MIT |
| [Vite](https://vite.dev/) and TypeScript | Frontend build (not shipped in the page) | MIT / Apache-2.0 |

Portable builds bundle these components. OpenCASCADE is LGPL: its libraries ship as separate files in the build so they can be replaced. The AGPL source for Pliable is at https://github.com/DesignWeaver3D/Pliable.
