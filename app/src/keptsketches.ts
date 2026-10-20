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

export class KeptSketches {
  private list: KeptInfo[] = [];
  private readonly hidden = new Set<number>();
  private readonly cache = new Map<number, { rev: number; data: M.SketchData }>();
  private readonly curves = new Map<number, { rev: number; lines: THREE.LineSegments }>();
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
            const reply = await this.host.core.request<{ sketch: M.SketchData }>("sketch_get", { id: k.id });
            this.cache.set(k.id, { rev: k.rev, data: reply.sketch });
          } catch {
            // a sketch that cannot be read is simply not drawn
          }
        }
        for (const [id, c] of [...this.curves]) {
          if (!wanted.some((k) => k.id === id) || c.rev !== this.cache.get(id)?.rev) {
            this.group.remove(c.lines);
            c.lines.geometry.dispose();
            this.curves.delete(id);
          }
        }
        for (const k of wanted) {
          const cached = this.cache.get(k.id);
          if (!cached || this.curves.has(k.id)) continue;
          const lines = this.build(cached.data);
          this.group.add(lines);
          this.curves.set(k.id, { rev: cached.rev, lines });
        }
        for (const id of [...this.cache.keys()]) if (!this.list.some((k) => k.id === id)) this.cache.delete(id);
      } while (this.again);
    } finally {
      this.syncing = false;
    }
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
