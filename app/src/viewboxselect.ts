/** Box selection in the 3D view: the dragged rectangle, the badge that says what it selects, and the items it takes. */
import * as THREE from "three";
import { pointInRect, segmentHitsRect, segmentsInBox, triangleHitsRect, trianglesInBox, type Rect } from "./boxselect.ts";
import { DepthProbe } from "./occlusion.ts";
import { settings, updateSettings } from "./settings.ts";
import type { Kind, Sel } from "./viewport.ts";
import { occluded } from "./viewpick.ts";
import { clickOrProfile } from "./viewsketchpick.ts";
import { selectItems } from "./viewselection.ts";
import type { Viewport } from "./viewport.ts";

/** The part of the Viewport this file uses. */
export type BoxSelectContext = Pick<Viewport, "box" | "boxEl" | "camera" | "centreDots" | "centresShown" | "curveTargets" | "data" | "faceStarts" | "filterBadge" | "ghostMaterial" | "ghosted" | "heldKind" | "hoverLine" | "hoverMark" | "hovered" | "lastClick" | "markSource" | "mesh" | "model" | "onHoverBody" | "onProfileClick" | "onSelect" | "onSketchCurveClick" | "originAxisHalf" | "pixelSizeAtDistance" | "probe" | "profileTargets" | "raycaster" | "relatedMarks" | "renderer" | "sectionClip" | "selected" | "selectedLine" | "selectedMarks" | "surfaceMaterial">;

export function updateBox(view: BoxSelectContext, e: PointerEvent) {
  const b = view.box!;
  b.x1 = e.clientX;
  b.y1 = e.clientY;
  if (!b.active && Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 4) return;
  b.active = true;
  if (!view.boxEl) {
    view.boxEl = document.createElement("div");
    view.boxEl.style.cssText = "position:fixed;pointer-events:none;z-index:2;border:1px solid #4fc3f7;background:rgba(79,195,247,0.12)";
    document.body.appendChild(view.boxEl);
  }
  const crossing = b.x1 < b.x0;
  view.boxEl.style.left = Math.min(b.x0, b.x1) + "px";
  view.boxEl.style.top = Math.min(b.y0, b.y1) + "px";
  view.boxEl.style.width = Math.abs(b.x1 - b.x0) + "px";
  view.boxEl.style.height = Math.abs(b.y1 - b.y0) + "px";
  view.boxEl.style.borderStyle = crossing ? "dashed" : "solid"; // dashed = crossing, solid = window
  view.boxEl.style.borderColor = crossing ? "#8bc34a" : "#4fc3f7";
}

export function cancelBox(view: BoxSelectContext) {
  view.box = null;
  view.boxEl?.remove();
  view.boxEl = null;
  view.heldKind = null;
  updateFilterBadge(view);
}

/** A small badge says what a box drag will select whenever a key is held or the setting fixes the kind; its button clears the setting. */
export function updateFilterBadge(view: BoxSelectContext) {
  const fixed = settings.boxKind !== "auto" ? settings.boxKind : null;
  const shown = view.heldKind ?? fixed;
  if (!shown || shown === "body") {
    view.filterBadge?.remove();
    view.filterBadge = null;
    return;
  }
  if (!view.filterBadge) {
    const badge = document.createElement("div");
    badge.style.cssText = "position:fixed;left:50%;bottom:60px;transform:translateX(-50%);z-index:5;display:flex;gap:8px;align-items:center;padding:4px 10px;border-radius:12px;background:#2b2b2b;color:#eee;font:12px sans-serif;border:1px solid #4fc3f7";
    document.body.appendChild(badge);
    view.filterBadge = badge;
  }
  const badge = view.filterBadge;
  badge.replaceChildren();
  const label = document.createElement("span");
  label.textContent = `Box selects ${shown}s only${view.heldKind ? " (key held)" : " (set in Settings)"}`;
  badge.append(label);
  if (!view.heldKind && fixed) {
    const reset = document.createElement("button");
    reset.textContent = "Reset";
    reset.title = "Go back to choosing the kind from what is selected";
    reset.onclick = () => updateSettings({ boxKind: "auto" });
    badge.append(reset);
  }
}

export function finishBox(view: BoxSelectContext, e: PointerEvent) {
  const b = view.box!;
  cancelBox(view);
  if (!b.active) {
    // Plain click on empty space or a ctrl-click: ordinary pick.
    clickOrProfile(view, e, b.additive);
    return;
  }
  const rect = view.renderer.domElement.getBoundingClientRect();
  const r = {
    x0: Math.min(b.x0, b.x1) - rect.left,
    x1: Math.max(b.x0, b.x1) - rect.left,
    y0: Math.min(b.y0, b.y1) - rect.top,
    y1: Math.max(b.y0, b.y1) - rect.top,
  };
  const crossing = b.x1 < b.x0; // right-to-left touches; left-to-right must enclose
  // With no filter (no key held, the setting on All) the box takes faces, edges and vertices together.
  const only: Kind | null = view.heldKind ?? (settings.boxKind === "auto" ? null : settings.boxKind);
  const kinds: Kind[] = only ? [only] : ["vertex", "edge", "face"];
  let found: Sel[];
  view.camera.updateMatrixWorld();
  if (!settings.seeThrough && view.mesh) {
    view.mesh.updateMatrixWorld();
    view.probe = new DepthProbe(view.renderer); // one depth picture serves the vertex, edge and face passes
    view.probe.capture(view.mesh, view.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera, rect.width, rect.height, view.sectionClip);
  }
  try {
    found = kinds.flatMap((kind) => itemsInBox(view, kind, r, crossing, rect));
  } finally {
    view.probe = null;
  }
  let next = found;
  if (b.additive) {
    const same = view.selected.filter((s) => kinds.includes(s.kind as Kind));
    next = [...same, ...found.filter((f) => !same.some((s) => s.kind === f.kind && s.id === f.id))];
  }
  selectItems(view, next);
  view.onSelect(next);
}

export function itemsInBox(view: BoxSelectContext, kind: Kind, r: Rect, crossing: boolean, rect: DOMRect): Sel[] {
  const data = view.data;
  if (!data) return [];
  const out: Sel[] = [];
  const scratch = new THREE.Vector3();
  const proj = (x: number, y: number, z: number) => {
    const n = scratch.set(x, y, z).project(view.camera);
    return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height, behind: n.z > 1 };
  };
  /** An item is visible if any of a few sample points on it (spread along it) is not behind the model. */
  const anyVisible = (samples: THREE.Vector3[]) => samples.some((p) => !occluded(view, p));
  const spread = <T,>(items: T[], n: number): T[] => {
    if (items.length <= n) return items;
    return Array.from({ length: n }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / n)]);
  };
  if (kind === "vertex") {
    for (const v of data.vertices) {
      const q = proj(v.position[0], v.position[1], v.position[2]);
      if (!q.behind && pointInRect(q, r) && !occluded(view, new THREE.Vector3(v.position[0], v.position[1], v.position[2]))) out.push({ kind, id: v.id });
    }
  } else if (kind === "edge") {
    const ep = data.edgePositions;
    for (const edge of data.edges) {
      if (edge.count === 0) continue;
      const pts: Array<{ x: number; y: number }> = [];
      let behind = false;
      for (let i = edge.start; i < edge.start + edge.count; i++) {
        const q = proj(ep[i * 3], ep[i * 3 + 1], ep[i * 3 + 2]);
        if (q.behind) behind = true;
        pts.push(q);
      }
      if (behind || !segmentsInBox(pts, r, crossing)) continue;
      // Sample the middle of each segment that is inside or touches the box.
      const samples: THREE.Vector3[] = [];
      for (let i = 0; i + 1 < edge.count; i += 2) {
        if (!(crossing ? segmentHitsRect(pts[i], pts[i + 1], r) : true)) continue;
        const a = (edge.start + i) * 3;
        const b = (edge.start + i + 1) * 3;
        samples.push(new THREE.Vector3((ep[a] + ep[b]) / 2, (ep[a + 1] + ep[b + 1]) / 2, (ep[a + 2] + ep[b + 2]) / 2));
      }
      if (anyVisible(spread(samples, 6))) out.push({ kind, id: edge.id });
    }
  } else {
    const pos = data.positions;
    const idx = data.indices;
    for (const face of data.faces) {
      if (face.count === 0) continue;
      const pts: Array<{ x: number; y: number }> = [];
      let behind = false;
      for (let i = face.start; i < face.start + face.count; i++) {
        const v = idx[i] * 3;
        const q = proj(pos[v], pos[v + 1], pos[v + 2]);
        if (q.behind) behind = true;
        pts.push(q);
      }
      if (behind || !trianglesInBox(pts, r, crossing)) continue;
      // Sample the center of each triangle that is inside or overlaps the box.
      const samples: THREE.Vector3[] = [];
      for (let i = 0; i + 2 < face.count; i += 3) {
        if (crossing && !triangleHitsRect(pts[i], pts[i + 1], pts[i + 2], r)) continue;
        const c = new THREE.Vector3();
        for (let k = 0; k < 3; k++) {
          const v = idx[face.start + i + k] * 3;
          c.add(new THREE.Vector3(pos[v], pos[v + 1], pos[v + 2]));
        }
        samples.push(c.multiplyScalar(1 / 3));
      }
      if (anyVisible(spread(samples, 12))) out.push({ kind, id: face.id });
    }
  }
  return out;
}
