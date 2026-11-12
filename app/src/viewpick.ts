/** Picking in the 3D view: the vertex, hole center, edge, axis or face under the pointer, and whether a point is hidden behind the model. */
import * as THREE from "three";
import type { FaceRange } from "./client.ts";
import { settings } from "./settings.ts";
import { projectOnSegment, worldFraction } from "./segmentmath.ts";
import type { Hit, Sel } from "./viewport.ts";
import type { Viewport } from "./viewport.ts";

const EDGE_TIE_PX = 2; // edges this close on screen are told apart by depth
const toScreen = new THREE.Matrix4(); // scratch for nearestEdge

/** The part of the Viewport this file uses. */
export type PickContext = Pick<Viewport, "camera" | "centresShown" | "data" | "faceStarts" | "ghostMaterial" | "ghosted" | "lastClick" | "mesh" | "originAxisHalf" | "pixelSizeAtDistance" | "probe" | "raycaster" | "renderer" | "surfaceMaterial">;

export function pickHit(view: PickContext, e: PointerEvent): Hit | null {
  if (!view.mesh || !view.data) return null;
  const rect = view.renderer.domElement.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  view.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), view.camera);
  const hits = view.raycaster.intersectObject(view.mesh);
  const solidHit = hits.find((h) => !isGhostTriangle(view, h.faceIndex)); // see-through bodies never hide what is behind them
  const faceHit = solidHit ?? hits[0];
  // An edge or vertex counts as visible if it is not meaningfully behind the face under the
  // pointer; allow slack for the pick radius (it grows at grazing angles).
  const pixelSize = view.pixelSizeAtDistance(faceHit?.distance ?? 0, rect.height);
  const depthLimit = solidHit && !settings.seeThrough ? solidHit.distance * 1.01 + pixelSize * 12 : Infinity;

  // Face under the pointer; a small face shrinks the edge and point ranges so its borders do not swallow it.
  let lo = 0;
  if (faceHit && faceHit.faceIndex != null) {
    // Face ranges are sorted by start; find the last range starting at or before this triangle.
    let hi = view.faceStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (view.faceStarts[mid] <= faceHit.faceIndex) lo = mid;
      else hi = mid - 1;
    }
  }
  const under = faceHit && faceHit.faceIndex != null ? view.data.faces[lo] : null;
  const size = under ? faceScreenSize(view, under, rect) : Infinity;
  const edgeRange = Math.min(settings.edgePickPx, Math.max(2, size / 4));
  const pointRange = Math.min(settings.vertexPickPx, Math.max(3, size / 3));

  const vertex = nearestVertex(view, px, py, rect, depthLimit, pointRange);
  if (vertex) return vertex;
  const centre = nearestCentre(view, px, py, rect);
  if (centre) return centre;
  const edge = nearestEdge(view, px, py, rect, depthLimit, edgeRange);
  if (edge) return edge;
  const axis = nearestAxis(view, px, py, rect, depthLimit);
  if (axis) return axis;

  if (!faceHit || faceHit.faceIndex == null) return null;
  const face = view.data.faces[lo];
  if (!face || face.count === 0) return null;
  const surfaceNormal = faceHit.face ? faceHit.face.normal.clone().transformDirection(view.mesh.matrixWorld) : undefined;
  return { kind: "face", id: face.id, point: faceHit.point, surfaceNormal };
}

export function pick(view: PickContext, e: PointerEvent): Sel | null {
  const hit = pickHit(view, e);
  return hit && { kind: hit.kind, id: hit.id };
}

/** What is under the pointer: a vertex, else an edge, else a face (vertices and edges only if not hidden behind a face). */
/** The face or edge of the model under the pointer (for the sketch's project picking), or null. */
export function pickModelItem(view: PickContext, e: PointerEvent): Sel | null {
  const hit = pickHit(view, e);
  return hit && (hit.kind === "face" || hit.kind === "edge") ? { kind: hit.kind, id: hit.id } : null;
}

/** A click pick; in see-through mode clicking the same spot again goes to the next face behind the previous one. */
export function pickCycling(view: PickContext, e: PointerEvent): Sel | null {
  const through = settings.seeThrough || e.altKey; // Alt+click cycles through hidden faces without see-through
  const hit = pickHit(view, e);
  const same = Math.hypot(e.clientX - view.lastClick.x, e.clientY - view.lastClick.y) < 3;
  if (!through || !hit || hit.kind !== "face") {
    view.lastClick = { x: e.clientX, y: e.clientY, n: 0 };
    return hit && { kind: hit.kind, id: hit.id, ...(hit.centre ? { centre: true } : {}) };
  }
  const faces = facesUnder(view, e);
  const n = same && faces.length ? (view.lastClick.n + 1) % faces.length : 0;
  view.lastClick = { x: e.clientX, y: e.clientY, n };
  return faces.length ? { kind: "face", id: faces[n] } : { kind: hit.kind, id: hit.id };
}

/** Ids of every face the ray under the pointer passes through, nearest first. */
export function facesUnder(view: PickContext, e: PointerEvent): number[] {
  if (!view.mesh || !view.data) return [];
  const rect = view.renderer.domElement.getBoundingClientRect();
  view.raycaster.setFromCamera(
    new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
    view.camera,
  );
  const ids: number[] = [];
  // The ray test skips back-facing triangles unless the material is double sided, which would hide every face behind the first.
  const materials = [view.surfaceMaterial, view.ghostMaterial].filter((m): m is THREE.MeshPhysicalMaterial => !!m);
  const sides = materials.map((m) => m.side);
  for (const m of materials) m.side = THREE.DoubleSide;
  const hits = view.raycaster.intersectObject(view.mesh);
  materials.forEach((m, i) => (m.side = sides[i]));
  for (const hit of hits) {
    if (hit.faceIndex == null) continue;
    const id = faceIdAt(view, hit.faceIndex);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function faceIdAt(view: PickContext, triangle: number): number | null {
  let lo = 0;
  let hi = view.faceStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (view.faceStarts[mid] <= triangle) lo = mid;
    else hi = mid - 1;
  }
  const face = view.data!.faces[lo];
  return face && face.count > 0 ? face.id : null;
}

/** Whether the triangle belongs to a see-through body. */
export function isGhostTriangle(view: PickContext, triangle: number | null | undefined): boolean {
  if (view.ghosted.size === 0 || triangle == null || !view.data) return false;
  let lo = 0;
  let hi = view.faceStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (view.faceStarts[mid] <= triangle) lo = mid;
    else hi = mid - 1;
  }
  const face = view.data.faces[lo];
  return !!face && face.body != null && view.ghosted.has(face.body);
}

/** The face a pick lands on: the nearest solid one, else the nearest see-through one. */
export function pickFace(view: PickContext, hits: THREE.Intersection[]): THREE.Intersection | undefined {
  return hits.find((h) => !isGhostTriangle(view, h.faceIndex)) ?? hits[0];
}

/** Face under the pointer and the point where the ray meets it, ignoring edges and vertices (used by snapping). */
export function faceUnder(view: PickContext, e: PointerEvent): { id: number; point: THREE.Vector3 } | null {
  if (!view.mesh || !view.data) return null;
  const rect = view.renderer.domElement.getBoundingClientRect();
  view.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view.camera);
  const hit = pickFace(view, view.raycaster.intersectObject(view.mesh));
  if (!hit || hit.faceIndex == null) return null;
  let lo = 0;
  let hi = view.faceStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (view.faceStarts[mid] <= hit.faceIndex) lo = mid;
    else hi = mid - 1;
  }
  const face = view.data.faces[lo];
  return face && face.count > 0 ? { id: face.id, point: hit.point } : null;
}

/** Whether a world point is hidden behind the model (never, in see-through mode). */
export function occluded(view: PickContext, p: THREE.Vector3): boolean {
  if (settings.seeThrough || !view.mesh) return false;
  if (view.probe) return view.probe.hidden(p); // inside a box select: one depth picture answers every point
  const dir = p.clone().sub(view.camera.position);
  const distance = dir.length();
  view.raycaster.set(view.camera.position, dir.normalize());
  const hit = view.raycaster.intersectObject(view.mesh).find((h) => !isGhostTriangle(view, h.faceIndex));
  return !!hit && hit.distance < distance * 0.995;
}

export function rayAt(view: PickContext, e: PointerEvent): THREE.Ray {
  const rect = view.renderer.domElement.getBoundingClientRect();
  view.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view.camera);
  return view.raycaster.ray.clone();
}

/** A hole or boss center near the pointer picks that hole's face (centers sit inside the hole, so no depth test). */
export function nearestCentre(view: PickContext, px: number, py: number, rect: DOMRect): Hit | null {
  let best: Hit | null = null;
  let bestDistance = settings.vertexPickPx;
  for (const c of view.centresShown) {
    const p = new THREE.Vector3(...c.position);
    const n = p.clone().project(view.camera);
    if (n.z > 1) continue;
    const d = Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py);
    if (d < bestDistance && !occluded(view, p)) {
      bestDistance = d;
      best = { kind: "face", id: c.face, point: p, centre: true };
    }
  }
  return best;
}

/** The larger side of a face's bounding box on screen, in pixels (the face's visible size for pick ranges). */
export function faceScreenSize(view: PickContext, face: FaceRange, rect: DOMRect): number {
  const data = view.data!;
  // Hovering asks this on every pointer move, and a large face has thousands of corners: the answer is kept while the
  // face, the mesh, the camera and the view size stay the same.
  view.camera.updateMatrixWorld();
  const key = [...view.camera.matrixWorld.elements, ...view.camera.projectionMatrix.elements, rect.width, rect.height];
  if (sizeMemo && sizeMemo.data === data && sizeMemo.face === face && sizeMemo.key.every((n, i) => n === key[i])) return sizeMemo.size;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const p = new THREE.Vector3();
  for (let i = face.start; i < face.start + face.count; i++) {
    p.fromArray(data.positions, data.indices[i] * 3).project(view.camera);
    const x = ((p.x + 1) / 2) * rect.width;
    const y = ((1 - p.y) / 2) * rect.height;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const size = Math.max(maxX - minX, maxY - minY);
  sizeMemo = { data, face, key, size };
  return size;
}

let sizeMemo: { data: unknown; face: FaceRange; key: number[]; size: number } | null = null;

export function nearestVertex(view: PickContext, px: number, py: number, rect: DOMRect, depthLimit: number, range = settings.vertexPickPx): Hit | null {
  let best: Hit | null = null;
  let bestDistance = range;
  const p = new THREE.Vector3();
  for (const v of view.data!.vertices) {
    p.set(v.position[0], v.position[1], v.position[2]);
    const depth = p.distanceTo(view.camera.position);
    const n = p.clone().project(view.camera);
    if (n.z > 1 || depth > depthLimit) continue;
    const d = Math.hypot(((n.x + 1) / 2) * rect.width - px, ((1 - n.y) / 2) * rect.height - py);
    if (d < bestDistance) {
      bestDistance = d;
      best = { kind: "vertex", id: v.id, point: p.clone() };
    }
  }
  return best;
}

export function nearestEdge(view: PickContext, px: number, py: number, rect: DOMRect, depthLimit: number, range = settings.edgePickPx): Hit | null {
  const data = view.data!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  view.camera.updateMatrixWorld();
  let best: Hit | null = null;
  const edgePx = range;
  let bestDistance = edgePx;
  let bestDepth = Infinity;
  const viewDepth = (v: THREE.Vector3) => -v.clone().applyMatrix4(view.camera.matrixWorldInverse).z; // distance along the viewing direction
  // Every segment of every edge is put on the screen on each pointer move, so this loop makes no objects: one matrix
  // takes a model point to the screen, and a segment whose box on screen is out of reach is dropped before any more work.
  const m = toScreen.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse).elements;
  const positions = data.edgePositions;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  for (const edge of data.edges) {
    for (let i = edge.start; i + 1 < edge.start + edge.count; i += 2) {
      const o = i * 3;
      const x0 = positions[o], y0 = positions[o + 1], z0 = positions[o + 2];
      const x1 = positions[o + 3], y1 = positions[o + 4], z1 = positions[o + 5];
      const w0 = 1 / (m[3] * x0 + m[7] * y0 + m[11] * z0 + m[15]);
      const w1 = 1 / (m[3] * x1 + m[7] * y1 + m[11] * z1 + m[15]);
      const az = (m[2] * x0 + m[6] * y0 + m[10] * z0 + m[14]) * w0;
      const bz = (m[2] * x1 + m[6] * y1 + m[10] * z1 + m[14]) * w1;
      if (az > 1 || bz > 1) continue;
      const ax = ((m[0] * x0 + m[4] * y0 + m[8] * z0 + m[12]) * w0 + 1) * halfW;
      const ay = (1 - (m[1] * x0 + m[5] * y0 + m[9] * z0 + m[13]) * w0) * halfH;
      const bx = ((m[0] * x1 + m[4] * y1 + m[8] * z1 + m[12]) * w1 + 1) * halfW;
      const by = (1 - (m[1] * x1 + m[5] * y1 + m[9] * z1 + m[13]) * w1) * halfH;
      if ((ax < px - edgePx && bx < px - edgePx) || (ax > px + edgePx && bx > px + edgePx) || (ay < py - edgePx && by < py - edgePx) || (ay > py + edgePx && by > py + edgePx)) continue;
      const { t, dist: d } = projectOnSegment(px, py, ax, ay, bx, by);
      if (d >= edgePx) continue;
      a.set(x0, y0, z0);
      b.set(x1, y1, z1);
      // t is a fraction of the picture of the segment; in perspective it is not the same fraction of the segment itself, and
      // the nearer the camera the bigger the difference (which hid the middle of long edges when zoomed in).
      const along = view.camera.type === "PerspectiveCamera" ? worldFraction(t, viewDepth(a), viewDepth(b)) : t;
      const point = a.clone().lerp(b, along);
      const depth = point.distanceTo(view.camera.position);
      if (depth > depthLimit) continue;
      // Nearest on screen wins, but among candidates within a couple of pixels the one
      // closest to the camera wins (e.g. a hole's front rim over its back rim seen through it).
      if (best && !(d + EDGE_TIE_PX < bestDistance || (d <= bestDistance + EDGE_TIE_PX && depth < bestDepth))) continue;
      bestDistance = d;
      bestDepth = depth;
      best = { kind: "edge", id: edge.id, point };
    }
  }
  return best;
}

/** The global axis line (X, Y or Z through the origin, as long as it is drawn) under the pointer, when it is not hidden behind a face. */
export function nearestAxis(view: PickContext, px: number, py: number, rect: DOMRect, depthLimit: number): Hit | null {
  if (view.originAxisHalf <= 0) return null;
  view.camera.updateMatrixWorld();
  const toPx = (v: THREE.Vector3) => {
    const n = v.clone().project(view.camera);
    return [((n.x + 1) / 2) * rect.width, ((1 - n.y) / 2) * rect.height, n.z] as const;
  };
  let best: Hit | null = null;
  let bestDistance = settings.edgePickPx;
  for (let k = 0; k < 3; k++) {
    const a = new THREE.Vector3().setComponent(k, -view.originAxisHalf);
    const b = new THREE.Vector3().setComponent(k, view.originAxisHalf);
    const [ax, ay, az] = toPx(a);
    const [bx, by, bz] = toPx(b);
    if (az > 1 || bz > 1) continue;
    const { t, dist: d } = projectOnSegment(px, py, ax, ay, bx, by);
    if (d >= bestDistance) continue;
    const point = a.clone().lerp(b, t);
    if (point.distanceTo(view.camera.position) > depthLimit) continue;
    bestDistance = d;
    best = { kind: "axis", id: k, point };
  }
  return best;
}
