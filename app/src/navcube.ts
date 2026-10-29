/** Navigation cube: a small CSS 3D cube that mirrors the camera; clicking a face looks at the model from that side. */
import { AXIS_COLORS } from "./axes";
import { uiIcon } from "./icons";
import type { Viewport } from "./viewport";

const CUBE_PX = 64; // edge length of the cube
const FACES: { view: string; label: string; transform: string }[] = [
  { view: "front", label: "Front", transform: `translateZ(${CUBE_PX / 2}px)` },
  { view: "rear", label: "Rear", transform: `rotateY(180deg) translateZ(${CUBE_PX / 2}px)` },
  { view: "right", label: "Right", transform: `rotateY(90deg) translateZ(${CUBE_PX / 2}px)` },
  { view: "left", label: "Left", transform: `rotateY(-90deg) translateZ(${CUBE_PX / 2}px)` },
  { view: "top", label: "Top", transform: `rotateX(90deg) translateZ(${CUBE_PX / 2}px)` },
  { view: "bottom", label: "Bottom", transform: `rotateX(-90deg) translateZ(${CUBE_PX / 2}px)` },
];

/** Number keys for the standard views. */
export const VIEW_KEYS: Record<string, string> = { "0": "iso", "1": "front", "2": "top", "3": "right", "4": "rear", "5": "bottom", "6": "left" };

export class NavCube {
  private readonly cube = document.createElement("div");
  /** The row of view buttons above the cube (projection, and the axes and see-through buttons moved into it). */
  readonly group = document.createElement("div");
  /** The row under the cube: zoom to fit everything, the isometric view, zoom to fit the selection. */
  private readonly lower = document.createElement("div");
  readonly fitSelectedButton = document.createElement("button");
  readonly projectionButton = document.createElement("button");

  constructor(
    host: HTMLElement,
    private readonly viewport: Viewport,
  ) {
    host.className = "navcube";
    const scene = document.createElement("div");
    scene.className = "navcube-scene";
    scene.style.width = scene.style.height = `${CUBE_PX}px`;
    this.cube.className = "navcube-cube";
    for (const face of FACES) {
      const el = document.createElement("div");
      el.className = "navcube-face";
      el.textContent = face.label;
      el.title = `${face.label} view`;
      el.style.width = el.style.height = `${CUBE_PX}px`;
      el.style.lineHeight = `${CUBE_PX}px`;
      el.style.transform = face.transform;
      el.addEventListener("click", () => viewport.setView(face.view));
      this.cube.append(el);
    }
    this.addOriginEdges();
    scene.append(this.cube);
    const home = document.createElement("button");
    home.id = "isoview";
    home.append(uiIcon("iso"));
    home.title = "Isometric view (0)";
    home.addEventListener("click", () => viewport.setView("iso"));
    this.projectionButton.addEventListener("click", () => this.toggleProjection());
    const fitAll = document.createElement("button");
    fitAll.id = "fitall";
    fitAll.append(uiIcon("fitAll"));
    fitAll.title = "Zoom to fit everything";
    fitAll.addEventListener("click", () => viewport.fitAll());
    this.fitSelectedButton.id = "fitselected";
    this.fitSelectedButton.append(uiIcon("fitSelected"));
    this.fitSelectedButton.title = "Zoom to fit the selected body, face or edge";
    this.fitSelectedButton.disabled = true;
    this.fitSelectedButton.addEventListener("click", () => viewport.fitSelected());
    this.group.className = "viewctl";
    this.group.append(this.projectionButton);
    this.lower.className = "viewctl";
    this.lower.append(fitAll, home, this.fitSelectedButton);
    host.append(this.group, scene, this.lower);
    this.viewport.onProjectionChange = () => this.updateProjectionLabel();
    this.updateProjectionLabel();
  }

  /**
   * The three cube edges that meet at the model's origin corner (the corner at -X, -Y, -Z, where the positive axes
   * leave it), colored like the origin axes. The cube's own frame is CSS: x = world X, y(down) = world -Z, z = world -Y.
   */
  private addOriginEdges() {
    const half = CUBE_PX / 2;
    const edges: { color: number; move: string; turn: string }[] = [
      { color: AXIS_COLORS.x, move: `translate3d(0, ${half}px, ${half}px)`, turn: "" },
      { color: AXIS_COLORS.y, move: `translate3d(${-half}px, ${half}px, 0)`, turn: "rotateY(90deg)" },
      { color: AXIS_COLORS.z, move: `translate3d(${-half}px, 0, ${half}px)`, turn: "rotateZ(90deg)" },
    ];
    for (const e of edges) {
      // Two crossed strips make the edge visible from either side.
      for (const roll of ["", "rotateX(90deg)"]) {
        const bar = document.createElement("div");
        bar.className = "navcube-edge";
        bar.style.cssText = `position:absolute;left:0;top:${half - 2}px;width:${CUBE_PX}px;height:4px;pointer-events:none;background:#${e.color.toString(16).padStart(6, "0")}`;
        bar.style.transform = `${e.move} ${e.turn} ${roll}`;
        this.cube.append(bar);
      }
    }
  }

  toggleProjection() {
    this.viewport.setOrthographic(!this.viewport.orthographic);
    this.updateProjectionLabel();
  }

  private updateProjectionLabel() {
    const ortho = this.viewport.orthographic;
    this.projectionButton.replaceChildren(uiIcon(ortho ? "orthographic" : "perspective"));
    this.projectionButton.title = `${ortho ? "Orthographic" : "Perspective"} view: click to switch to ${ortho ? "perspective" : "orthographic"} (P)`;
  }

  /** Called every frame. */
  update() {
    this.cube.style.transform = this.viewport.viewMatrixCss();
  }
}
