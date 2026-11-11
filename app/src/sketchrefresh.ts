/** Solving the open sketch and refreshing what follows from it: remaining freedom, the closed regions and their tint. */
import * as THREE from "three";
import * as M from "./sketchmodel.ts";
import type { Drag } from "./sketchtypes.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

/** Solve the constraints (latest request wins while one is in flight). Resolves true if the solver succeeded. */
export function resolveSketch(mode: SketchMode, drag?: Drag): Promise<boolean> {
  return mode.solver.resolve(drag).then((ok) => (ok ? ok : withoutAxisHolds(mode, drag)));
}

/** The solve failed: try dropping the holds on sketch axes (newest first), which can be redundant with a drawn side. Keeps them all when that does not help. */
export async function withoutAxisHolds(mode: SketchMode, drag?: Drag): Promise<boolean> {
  const before = mode.s.constraints;
  const holds = before.filter((c) => c.axisHold);
  for (let n = 1; n <= holds.length; n++) {
    const drop = new Set(holds.slice(-n).map((c) => c.id));
    mode.s.constraints = before.filter((c) => !drop.has(c.id));
    if (await mode.solver.resolve(drag)) return true;
  }
  if (holds.length) {
    mode.s.constraints = before;
    await mode.solver.resolve(drag);
  }
  return false;
}

/** How free each point still is (its color), worked out after the solve so the shape and its dimensions update first; a newer solve discards an older answer. */
export async function refreshFreedom(mode: SketchMode) {
  const seq = ++mode.freedomSeq;
  try {
    const reply = await mode.core.request<{ freedom: Record<string, number>; free_sizes?: number[] }>("sketch_freedom", { sketch: M.forSolver(mode.s) });
    if (seq !== mode.freedomSeq || !mode.active) return;
    mode.freedom = new Map(Object.entries(reply.freedom).map(([id, n]) => [Number(id), n]));
    mode.freeSizes = new Set(reply.free_sizes ?? []);
    renderSketch(mode, false);
  } catch {
    // the points keep their earlier colors
  }
}

/** The sketch's closed regions as view-only tinted faces, redrawn after every solve, so a closed profile shows at once. */
export async function refreshProfiles(mode: SketchMode) {
  const seq = ++mode.profileSeq;
  let profiles: { positions: number[]; indices: number[] }[] = [];
  try {
    profiles = (await mode.core.request<{ profiles: typeof profiles }>("sketch_profiles", { sketch: M.forSolver(mode.s, false) })).profiles;
  } catch {
    // a sketch the core cannot split into regions simply shows none
  }
  if (seq === mode.profileSeq && mode.active) setProfiles(mode, profiles);
}

/** Whether a sketch point lies inside a closed region (a tinted profile face), and how far to look from the geometry (about 40 px): dimensions are placed outside the faces. */
export function outsideGeometry(mode: SketchMode): M.Outside | undefined {
  if (!mode.profileData.length || !mode.s.constraints.some((c) => c.value !== undefined || c.reference)) return undefined;
  const key = JSON.stringify(mode.s.plane);
  if (mode.triangleCache?.data !== mode.profileData || mode.triangleCache.key !== key) {
    const triangles = mode.profileData.flatMap((m) => {
      const uv = (i: number) => M.toPlane(mode.s.plane, [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]);
      return Array.from({ length: Math.floor(m.indices.length / 3) }, (_, t) => [uv(m.indices[3 * t]), uv(m.indices[3 * t + 1]), uv(m.indices[3 * t + 2])]);
    });
    mode.triangleCache = { data: mode.profileData, key, triangles };
  }
  const triangles = mode.triangleCache.triangles;
  const inside = (u: number, v: number) =>
    triangles.some(([a, b, c]) => {
      const side = (p: number[], q: number[]) => (q[0] - p[0]) * (v - p[1]) - (q[1] - p[1]) * (u - p[0]);
      const [x, y, z] = [side(a, b), side(b, c), side(c, a)];
      return (x >= 0 && y >= 0 && z >= 0) || (x <= 0 && y <= 0 && z <= 0);
    });
  return { inside, probe: mode.pixelAt(0, 0) * 40 };
}

export function setProfiles(mode: SketchMode, profiles: { positions: number[]; indices: number[] }[]) {
  mode.profileData = profiles;
  if (mode.s.constraints.some((c) => c.value !== undefined || c.reference)) renderSketch(mode, false); // dimensions are placed outside the regions
  for (const old of mode.profileFills) {
    mode.group.remove(old);
    old.geometry.dispose();
    (old.material as THREE.Material).dispose();
  }
  mode.profileFills = profiles.map((m) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    geometry.setIndex(m.indices);
    const material = new THREE.MeshBasicMaterial({ color: 0x2fd4c0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const fill = new THREE.Mesh(geometry, material);
    fill.renderOrder = 3; // under the sketch lines (5) and axes (4), over the grid (1)
    fill.frustumCulled = false;
    mode.group.add(fill);
    return fill;
  });
}
