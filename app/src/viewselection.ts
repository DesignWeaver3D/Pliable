/** Selection and hover in the 3D view: the highlight marks, the hole center dots, and what a click does to the selection. */
import * as THREE from "three";
import type { CentreInfo } from "./client.ts";
import { canJoinSelection } from "./selfilter.ts";
import { Mark } from "./viewportmark.ts";
import type { Sel } from "./viewport.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type SelectionContext = Pick<Viewport, "centreDots" | "centresShown" | "data" | "hoverLine" | "hoverMark" | "hovered" | "markSource" | "mesh" | "model" | "onHoverBody" | "onSelect" | "originAxisHalf" | "relatedMarks" | "renderer" | "selected" | "selectedLine" | "selectedMarks">;

export function showMark(view: SelectionContext, mark: Mark | null, sel: Sel | null) {
  if (!mark || !view.mesh || !view.data) return;
  mark.hide();
  if (!sel) return;
  if (sel.kind === "body") {
    const faces = view.data.faces.filter((f) => f.body === sel.id && f.count > 0);
    if (faces.length === 0) return;
    const source = view.mesh.geometry.getIndex()!.array as Uint32Array;
    const indices = new Uint32Array(faces.reduce((n, f) => n + f.count, 0));
    let at = 0;
    for (const f of faces) {
      indices.set(source.subarray(f.start, f.start + f.count), at);
      at += f.count;
    }
    mark.face.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    mark.face.visible = true;
    const edges = view.data.edges.filter((e) => e.body === sel.id && e.count > 0);
    if (edges.length) {
      const lines = new Float32Array(edges.reduce((n, e) => n + e.count * 3, 0));
      let to = 0;
      for (const e of edges) {
        lines.set(view.data.edgePositions.subarray(e.start * 3, (e.start + e.count) * 3), to);
        to += e.count * 3;
      }
      mark.edge.geometry.setPositions(lines);
      mark.edge.visible = true;
    }
  } else if (sel.kind === "axis") {
    const half = view.originAxisHalf;
    if (half <= 0) return;
    const end = new THREE.Vector3().setComponent(sel.id, half);
    mark.edge.geometry.setPositions([-end.x, -end.y, -end.z, end.x, end.y, end.z]);
    mark.edge.visible = true;
  } else if (sel.kind === "face" && sel.centre) {
    // A hole picked by its center dot shows the dot only.
    const centre = view.data.centres.find((c) => c.face === sel.id);
    if (!centre) return;
    mark.vertex.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(centre.position), 3));
    mark.vertex.visible = true;
  } else if (sel.kind === "face") {
    const range = view.data.faces.find((f) => f.id === sel.id);
    if (!range) return;
    const source = view.mesh.geometry.getIndex()!.array as Uint32Array;
    mark.face.geometry.setIndex(new THREE.BufferAttribute(source.subarray(range.start, range.start + range.count), 1));
    mark.face.visible = true;
  } else if (sel.kind === "edge") {
    const range = view.data.edges.find((e) => e.id === sel.id);
    if (!range || range.count === 0) return;
    const positions = view.data.edgePositions.subarray(range.start * 3, (range.start + range.count) * 3);
    mark.edge.geometry.setPositions(positions);
    mark.edge.visible = true;
  } else {
    const vertex = view.data.vertices.find((v) => v.id === sel.id);
    if (!vertex) return;
    mark.vertex.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertex.position), 3));
    mark.vertex.visible = true;
  }
}

/** The center of a circular edge, found from the hole centers: every point of the edge is one radius from it. */
export function circleCentre(view: SelectionContext, edgeId: number): CentreInfo | null {
  const data = view.data;
  const edge = data?.edges.find((e) => e.id === edgeId);
  if (!data || !edge || edge.count < 4) return null;
  const pts: THREE.Vector3[] = [];
  for (let i = edge.start; i < edge.start + edge.count; i++) pts.push(new THREE.Vector3().fromArray(data.edgePositions, i * 3));
  const tol = 1e-3;
  for (const c of data.centres) {
    const centre = new THREE.Vector3(...c.position);
    const axis = new THREE.Vector3(...c.axis).normalize();
    let axial: number | null = null;
    let radius: number | null = null;
    let ok = true;
    for (const p of pts) {
      const d = p.clone().sub(centre);
      const along = d.dot(axis);
      const r = d.addScaledVector(axis, -along).length();
      axial ??= along;
      radius ??= r;
      if (Math.abs(along - axial) > tol || Math.abs(r - radius) > tol || r < tol) {
        ok = false;
        break;
      }
    }
    if (ok && axial !== null) return { face: c.face, position: centre.addScaledVector(axis, axial).toArray() as [number, number, number], axis: c.axis };
  }
  return null;
}

/** Show center dots only for the hovered or selected holes and circular edges. */
export function refreshCentres(view: SelectionContext) {
  const shown: CentreInfo[] = [];
  for (const sel of [view.hovered, ...view.selected]) {
    if (!sel || !view.data) continue;
    if (sel.kind === "face") shown.push(...view.data.centres.filter((c) => c.face === sel.id));
    else if (sel.kind === "edge") {
      const c = circleCentre(view, sel.id);
      if (c) shown.push(c);
    }
  }
  view.centresShown = shown;
  if (view.centreDots) {
    view.centreDots.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(shown.flatMap((c) => c.position)), 3));
    view.centreDots.geometry = g;
  }
}

/** The id of the body an item belongs to, if the mesh says. */
export function bodyOf(view: SelectionContext, sel: Sel | null): number | null {
  if (!sel || !view.data) return null;
  if (sel.kind === "body") return sel.id;
  const table = sel.kind === "face" ? view.data.faces : sel.kind === "edge" ? view.data.edges : view.data.vertices;
  return table.find((x) => x.id === sel.id)?.body ?? null;
}

export function setHover(view: SelectionContext, sel: Sel | null) {
  if (sel?.kind === view.hovered?.kind && sel?.id === view.hovered?.id && !!sel?.centre === !!view.hovered?.centre) return;
  view.hovered = sel;
  view.onHoverBody(bodyOf(view, sel));
  refreshCentres(view);
  showMark(view, view.hoverMark, sel);
  view.renderer.domElement.style.cursor = sel ? "pointer" : "";
}

export function isSelected(view: SelectionContext, sel: Sel): boolean {
  return view.selected.some((s) => s.kind === sel.kind && s.id === sel.id);
}

/** Faintly highlight faces related to the selection (the relationship rules that are switched on). */
export function setRelated(view: SelectionContext, sels: Sel[]) {
  while (view.relatedMarks.length < sels.length && view.markSource) {
    view.relatedMarks.push(new Mark(view.model, view.markSource, 0xffb36b, 0.4, view.hoverLine));
  }
  view.relatedMarks.forEach((mark, i) => showMark(view, mark, sels[i] ?? null));
}

/** Select programmatically (no onSelect callback). */
export function selectItems(view: SelectionContext, sels: Sel[]) {
  view.selected = sels;
  refreshCentres(view);
  while (view.selectedMarks.length < sels.length && view.markSource) {
    view.selectedMarks.push(new Mark(view.model, view.markSource, 0xff8a1f, 0.85, view.selectedLine));
  }
  view.selectedMarks.forEach((mark, i) => showMark(view, mark, sels[i] ?? null));
}

/** Plain click replaces the selection; Ctrl+click toggles an item (all items must be of one kind). */
export function clickSelect(view: SelectionContext, sel: Sel | null, additive: boolean) {
  let next: Sel[];
  if (!additive) next = sel ? [sel] : [];
  else if (!sel) next = view.selected;
  else if (isSelected(view, sel)) next = view.selected.filter((s) => !(s.kind === sel.kind && s.id === sel.id));
  else next = view.selected.length && canJoinSelection(view.selected[0].kind, sel.kind) ? [...view.selected, sel] : [sel];
  selectItems(view, next);
  view.onSelect(next);
}
