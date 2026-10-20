/** The sketches kept in the document: a list under the bodies (show or hide, open, rename, delete) and their curves drawn in the view. Open paths are kept like closed outlines. */
import * as THREE from "three";
import type { CoreClient } from "./client";
import { uiIcon } from "./icons";
import * as M from "./sketchmodel";

export interface KeptInfo {
  id: number;
  name: string;
  rev: number;
}

export interface KeptHost {
  core: CoreClient;
  scene: THREE.Scene;
  list: HTMLElement;
  count: HTMLElement;
  /** Open the sketch for editing. */
  open(id: number): void;
  remove(id: number): void;
  rename(id: number, name: string): void;
}

const CURVE_COLOR = 0x9bb7d4;
/** Closed regions are drawn as tinted faces that belong to no model: this colour is used for nothing else. */
const PROFILE_COLOR = 0x2fd4c0;

export class KeptSketches {
  private list: KeptInfo[] = [];
  private readonly hidden = new Set<number>();
  private readonly cache = new Map<number, { rev: number; data: M.SketchData }>();
  private readonly curves = new Map<number, { rev: number; lines: THREE.LineSegments; fills: THREE.Mesh[] }>();
  private readonly profiles = new Map<number, { rev: number; meshes: { positions: number[]; indices: number[] }[] }>();
  private editing: number | null = null;
  private readonly group = new THREE.Group();
  private syncing = false;
  private again = false;
  private readonly host: KeptHost;

  constructor(host: KeptHost) {
    this.host = host;
    this.group.renderOrder = 4;
    host.scene.add(this.group);
    this.render();
  }

  /** The document's sketches changed (every committed state, so undo and redo come through here too). */
  setList(list: KeptInfo[]) {
    if (JSON.stringify(list) === JSON.stringify(this.list)) return;
    this.list = list;
    for (const id of [...this.hidden]) if (!list.some((k) => k.id === id)) this.hidden.delete(id);
    this.render();
    void this.sync();
  }

  /** The sketch being edited is drawn by the sketch editor; its kept copy is hidden meanwhile. */
  setEditing(id: number | null) {
    this.editing = id;
    void this.sync();
  }

  private render() {
    const { list, count } = this.host;
    count.textContent = String(this.list.length);
    list.replaceChildren();
    for (const k of this.list) {
      const row = document.createElement("div");
      row.className = "bodyrow keptrow";
      const eye = document.createElement("button");
      eye.className = "rowbtn";
      eye.title = this.hidden.has(k.id) ? "Show this sketch" : "Hide this sketch";
      eye.append(uiIcon(this.hidden.has(k.id) ? "eyeOff" : "eye", 14));
      eye.addEventListener("click", () => {
        if (this.hidden.has(k.id)) this.hidden.delete(k.id);
        else this.hidden.add(k.id);
        this.render();
        void this.sync();
      });
      const name = document.createElement("span");
      name.className = "bodyname";
      name.textContent = k.name;
      name.title = "Double-click to rename";
      name.addEventListener("dblclick", () => this.rename(k, name));
      const edit = document.createElement("button");
      edit.className = "rowbtn";
      edit.title = "Edit this sketch";
      edit.append(uiIcon("edit", 14));
      edit.addEventListener("click", () => this.host.open(k.id));
      const del = document.createElement("button");
      del.className = "rowbtn";
      del.title = "Delete this sketch (Undo brings it back)";
      del.append(uiIcon("close", 14));
      del.addEventListener("click", () => this.host.remove(k.id));
      row.append(eye, name, edit, del);
      list.append(row);
    }
    if (!this.list.length) {
      const none = document.createElement("div");
      none.className = "nobodies";
      none.textContent = "No sketches yet";
      list.append(none);
    }
  }

  /** The drawn profile regions, so a click in the view can pick them like faces. */
  fillTargets(): { id: number; region: number; object: THREE.Object3D }[] {
    return [...this.curves].flatMap(([id, c]) => c.fills.map((object, region) => ({ id, region, object })));
  }

  private rename(k: KeptInfo, label: HTMLElement) {
    const input = document.createElement("input");
    input.value = k.name;
    input.className = "renamefield";
    let finished = false;
    const done = (commit: boolean) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (commit && value && value !== k.name) this.host.rename(k.id, value);
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

  /** Fetch what is missing and draw the visible sketches' curves; one pass at a time, rerun if the list changed meanwhile. */
  private async sync() {
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.again = false;
        const wanted = this.list.filter((k) => !this.hidden.has(k.id) && k.id !== this.editing);
        for (const k of wanted) {
          if (this.cache.get(k.id)?.rev === k.rev) continue;
          try {
            const reply = await this.host.core.request<{ sketch: M.SketchData }>("sketch_get", { sketch_id: k.id });
            this.cache.set(k.id, { rev: k.rev, data: reply.sketch });
          } catch {
            // a sketch that cannot be read is simply not drawn
          }
        }
        for (const k of wanted) {
          if (this.profiles.get(k.id)?.rev === k.rev) continue;
          try {
            const reply = await this.host.core.request<{ profiles: { positions: number[]; indices: number[] }[] }>("sketch_profiles", { sketch_id: k.id });
            this.profiles.set(k.id, { rev: k.rev, meshes: reply.profiles });
          } catch {
            this.profiles.set(k.id, { rev: k.rev, meshes: [] });
          }
        }
        for (const [id, c] of [...this.curves]) {
          if (!wanted.some((k) => k.id === id) || c.rev !== this.cache.get(id)?.rev) {
            for (const o of [c.lines, ...c.fills]) {
              this.group.remove(o);
              o.geometry.dispose();
            }
            this.curves.delete(id);
          }
        }
        for (const k of wanted) {
          const cached = this.cache.get(k.id);
          if (!cached || this.curves.has(k.id)) continue;
          const lines = this.build(cached.data);
          const fills = (this.profiles.get(k.id)?.meshes ?? []).map((m) => this.fill(m));
          this.group.add(lines, ...fills);
          this.curves.set(k.id, { rev: cached.rev, lines, fills });
        }
        for (const id of [...this.cache.keys()]) if (!this.list.some((k) => k.id === id)) this.cache.delete(id);
        for (const id of [...this.profiles.keys()]) if (!this.list.some((k) => k.id === id)) this.profiles.delete(id);
      } while (this.again);
    } finally {
      this.syncing = false;
    }
  }

  /** One closed region as a tinted face that belongs to no model; a click on it makes it a temporary face of the model (see pickProfile in main.ts). */
  private fill(mesh: { positions: number[]; indices: number[] }): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices);
    const material = new THREE.MeshBasicMaterial({ color: PROFILE_COLOR, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const fill = new THREE.Mesh(geometry, material);
    fill.renderOrder = 3;
    fill.frustumCulled = false;
    return fill;
  }

  private build(data: M.SketchData): THREE.LineSegments {
    const positions: number[] = [];
    for (const e of data.entities) {
      if (e.reference || e.construction) continue;
      const line = M.polyline(data, e);
      for (let i = 0; i + 1 < line.length; i++) positions.push(...M.toWorld(data.plane, line[i][0], line[i][1]), ...M.toWorld(data.plane, line[i + 1][0], line[i + 1][1]));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: CURVE_COLOR, depthTest: false, transparent: true, opacity: 0.85 }));
    lines.renderOrder = 4;
    lines.frustumCulled = false;
    return lines;
  }
}
