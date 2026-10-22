/** The datum planes kept in the document: a list under the sketches (show or hide, rename, delete) and each plane drawn
 *  in the view as a thin outlined square. They are helper planes for operations such as symmetric push/pull and mirror. */
import * as THREE from "three";
import { uiIcon } from "./icons";
import { DATUM_HALF, datumCorners, type DatumPlane, type MirrorMode } from "./datumcorners";

export interface DatumHost {
  scene: THREE.Scene;
  list: HTMLElement;
  count: HTMLElement;
  /** Where the mirror mode line goes (empty while the mode is off). */
  mirror: HTMLElement;
  mirrorOff(): void;
  remove(id: number): void;
  rename(id: number, name: string): void;
}

const DATUM_COLOR = 0xd49bd0;
const MIRROR_COLOR = 0xffb347;
export class DatumPlanes {
  private list: DatumPlane[] = [];
  private readonly hidden = new Set<number>();
  private readonly group = new THREE.Group();
  private mirror: MirrorMode | null = null;
  private readonly host: DatumHost;

  constructor(host: DatumHost) {
    this.host = host;
    this.group.renderOrder = 3;
    host.scene.add(this.group);
    this.render();
  }

  get planes(): readonly DatumPlane[] {
    return this.list;
  }

  /** Mirror mode changed (every committed state): show its plane and a line to turn it off. */
  setMirror(mirror: MirrorMode | null) {
    if (JSON.stringify(mirror) === JSON.stringify(this.mirror)) return;
    this.mirror = mirror;
    const line = this.host.mirror;
    line.replaceChildren();
    if (mirror) {
      const text = document.createElement("span");
      text.textContent = `Mirror mode: ${mirror.name}`;
      const off = document.createElement("button");
      off.className = "rowbtn";
      off.title = "Turn mirror mode off";
      off.append(uiIcon("close", 14));
      off.addEventListener("click", () => this.host.mirrorOff());
      line.append(text, off);
    }
    line.hidden = !mirror;
    this.draw();
  }

  /** The document's datum planes changed (every committed state, so undo and redo come through here too). */
  setList(list: DatumPlane[]) {
    if (JSON.stringify(list) === JSON.stringify(this.list)) return;
    this.list = list;
    for (const id of [...this.hidden]) if (!list.some((d) => d.id === id)) this.hidden.delete(id);
    this.render();
    this.draw();
  }

  private draw() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    for (const d of this.list) {
      if (this.hidden.has(d.id)) continue;
      const c = datumCorners(d.plane);
      const fill = new THREE.BufferGeometry();
      fill.setAttribute("position", new THREE.Float32BufferAttribute(c.flat(), 3));
      fill.setIndex([0, 1, 2, 0, 2, 3]);
      const sheet = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color: DATUM_COLOR, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      sheet.renderOrder = 3;
      sheet.frustumCulled = false;
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: DATUM_COLOR, transparent: true, opacity: 0.7, depthTest: false }));
      outline.renderOrder = 4;
      outline.frustumCulled = false;
      this.group.add(sheet, outline);
    }
    if (this.mirror) {
      const c = datumCorners(this.mirror.plane, DATUM_HALF * 1.15);
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: MIRROR_COLOR, transparent: true, opacity: 0.9, depthTest: false }));
      outline.renderOrder = 4;
      outline.frustumCulled = false;
      this.group.add(outline);
    }
  }

  private render() {
    const { list, count } = this.host;
    count.textContent = String(this.list.length);
    list.replaceChildren();
    for (const d of this.list) {
      const row = document.createElement("div");
      row.className = "bodyrow keptrow";
      const eye = document.createElement("button");
      eye.className = "rowbtn";
      eye.title = this.hidden.has(d.id) ? "Show this datum plane" : "Hide this datum plane";
      eye.append(uiIcon(this.hidden.has(d.id) ? "eyeOff" : "eye", 14));
      eye.addEventListener("click", () => {
        if (this.hidden.has(d.id)) this.hidden.delete(d.id);
        else this.hidden.add(d.id);
        this.render();
        this.draw();
      });
      const name = document.createElement("span");
      name.className = "bodyname";
      name.textContent = d.name;
      name.title = "Double-click to rename";
      name.addEventListener("dblclick", () => this.rename(d, name));
      const del = document.createElement("button");
      del.className = "rowbtn";
      del.title = "Delete this datum plane (Undo brings it back)";
      del.append(uiIcon("close", 14));
      del.addEventListener("click", () => this.host.remove(d.id));
      row.append(eye, name, del);
      list.append(row);
    }
    if (!this.list.length) {
      const none = document.createElement("div");
      none.className = "nobodies";
      none.textContent = "No datum planes yet";
      list.append(none);
    }
  }

  private rename(d: DatumPlane, label: HTMLElement) {
    const input = document.createElement("input");
    input.value = d.name;
    input.className = "renamefield";
    let finished = false;
    const done = (commit: boolean) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (commit && value && value !== d.name) this.host.rename(d.id, value);
      else this.render();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      else if (e.key === "Escape") done(false);
    });
    input.addEventListener("blur", () => done(false));
    label.replaceWith(input);
    input.focus();
    input.select();
  }
}
