/** Navigation cube: a small CSS 3D cube that mirrors the camera; clicking a face looks at the model from that side. */
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
    scene.append(this.cube);
    const home = document.createElement("button");
    home.textContent = "Iso (0)";
    home.title = "Isometric view (0)";
    home.addEventListener("click", () => viewport.setView("iso"));
    this.projectionButton.addEventListener("click", () => this.toggleProjection());
    host.append(scene, home, this.projectionButton);
    this.updateProjectionLabel();
  }

  toggleProjection() {
    this.viewport.setOrthographic(!this.viewport.orthographic);
    this.updateProjectionLabel();
  }

  private updateProjectionLabel() {
    this.projectionButton.textContent = this.viewport.orthographic ? "Orthographic" : "Perspective";
    this.projectionButton.title = "Toggle perspective / orthographic (P)";
  }

  /** Called every frame. */
  update() {
    this.cube.style.transform = this.viewport.viewMatrixCss();
  }
}
