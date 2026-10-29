/** The Tangent circle and Tangent arc between curves tools: a circle touching two or three picked lines, arcs or circles, solved here from the curves' present
 *  positions and then held by tangent constraints. With two curves the radius comes from the card; with three it is whatever touches all of them.
 *  Of the (up to eight) solutions the one whose center is nearest the pointer is made. No DOM. */
import * as M from "./sketchmodel.ts";

type Pt = [number, number];
type Curve = Extract<M.SketchEntity, { type: "line" | "arc" | "circle" }>;
/** A curve as the solver sees it: an infinite line (point and unit direction) or a full circle. */
type Geo = { line: true; p: Pt; d: Pt } | { line: false; c: Pt; r: number };

export interface TangentSolution {
  centre: Pt;
  radius: number;
  /** Where the circle touches each curve, in the order the curves were given. */
  touches: Pt[];
}

const at = (s: M.SketchData, id: number): Pt => [M.pointOf(s, id).u, M.pointOf(s, id).v];

export function isCurve(e: M.SketchEntity | undefined): e is Curve {
  return !!e && (e.type === "line" || e.type === "arc" || e.type === "circle");
}

function geoOf(s: M.SketchData, e: Curve): Geo {
  if (e.type === "line") {
    const [a, b] = [at(s, e.a), at(s, e.b)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { line: true, p: a, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] };
  }
  const c = at(s, e.center);
  return { line: false, c, r: e.type === "circle" ? e.radius : Math.hypot(at(s, e.start)[0] - c[0], at(s, e.start)[1] - c[1]) };
}

/** Solve a 3x3 linear system by Cramer's rule; null when singular. */
function solve3(a: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(a);
  if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((k) => det(a.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)))) / d);
}

/** Every circle (center, radius > 0) touching all the curves; `radius` fixes the radius (null leaves it free, which needs three curves). */
export function tangentCircles(s: M.SketchData, ids: number[], radius: number | null): TangentSolution[] {
  const curves = ids.map((id) => s.entities.find((e) => e.id === id)).filter(isCurve);
  if (curves.length !== ids.length || ids.length + (radius === null ? 0 : 1) !== 3) return [];
  const geos = curves.map((c) => geoOf(s, c));
  const out: TangentSolution[] = [];
  // Unknowns (x, y, r). A line: n . c - h = sign * r (linear). A circle: |c - o|^2 = (R + t r)^2, which with Q = x^2 + y^2 - r^2 is linear in (x, y, r) and Q.
  for (let mask = 0; mask < 1 << geos.length; mask++) {
    const sign = geos.map((_, i) => ((mask >> i) & 1 ? -1 : 1));
    const lin: number[][] = [];
    const rhs: number[] = [];
    let first: { row: number[]; k: number } | null = null; // the first circle: coefficients of x, y, r and the constant
    for (const [i, g] of geos.entries()) {
      if (g.line) {
        const n: Pt = [-g.d[1], g.d[0]];
        lin.push([n[0], n[1], -sign[i]]);
        rhs.push(n[0] * g.p[0] + n[1] * g.p[1]);
      } else {
        const row = [-2 * g.c[0], -2 * g.c[1], -2 * sign[i] * g.r];
        const k = g.c[0] ** 2 + g.c[1] ** 2 - g.r ** 2;
        if (!first) first = { row, k };
        else {
          lin.push(row.map((x, j) => x - first!.row[j]));
          rhs.push(-(k - first.k));
        }
      }
    }
    if (radius !== null) {
      lin.push([0, 0, 1]);
      rhs.push(radius);
    }
    const candidates: number[][] = [];
    if (!first) {
      const x = solve3(lin, rhs);
      if (x) candidates.push(x);
    } else {
      // Two linear rows leave a line of solutions p + lambda * dir; the first circle's equation then gives lambda.
      const [a, b] = lin;
      const dir = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      if (Math.hypot(...dir) < 1e-12) continue;
      const p = solve3([a, b, dir], [rhs[0], rhs[1], 0]);
      if (!p) continue;
      // x^2 + y^2 - r^2 + row . (x, y, r) + k = 0 along p + lambda * dir
      const q = (v: number[]) => v[0] * v[0] + v[1] * v[1] - v[2] * v[2];
      const cross = p[0] * dir[0] + p[1] * dir[1] - p[2] * dir[2];
      const qa = q(dir);
      const qb = 2 * cross + first.row[0] * dir[0] + first.row[1] * dir[1] + first.row[2] * dir[2];
      const qc = q(p) + first.row[0] * p[0] + first.row[1] * p[1] + first.row[2] * p[2] + first.k;
      const lambdas: number[] = [];
      if (Math.abs(qa) < 1e-12) {
        if (Math.abs(qb) > 1e-12) lambdas.push(-qc / qb);
      } else {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= -1e-9) {
          const root = Math.sqrt(Math.max(0, disc));
          lambdas.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
        }
      }
      for (const l of lambdas) candidates.push([p[0] + l * dir[0], p[1] + l * dir[1], p[2] + l * dir[2]]);
    }
    for (const [x, y, r] of candidates) {
      if (!(r > 1e-9) || !Number.isFinite(x + y + r)) continue;
      const touches = geos.map((g): Pt => {
        if (g.line) {
          const t = (x - g.p[0]) * g.d[0] + (y - g.p[1]) * g.d[1];
          return [g.p[0] + t * g.d[0], g.p[1] + t * g.d[1]];
        }
        const dist = Math.hypot(x - g.c[0], y - g.c[1]) || 1;
        // The touching point is on the line through both centers: the near side of the circle, or the far side when it lies inside ours.
        const [ux, uy] = [(x - g.c[0]) / dist, (y - g.c[1]) / dist];
        const near: Pt = [g.c[0] + ux * g.r, g.c[1] + uy * g.r];
        const far: Pt = [g.c[0] - ux * g.r, g.c[1] - uy * g.r];
        return Math.abs(Math.hypot(x - near[0], y - near[1]) - r) <= Math.abs(Math.hypot(x - far[0], y - far[1]) - r) ? near : far;
      });
      // Each candidate must really touch each curve (a root of the squared equation can be a spurious sign).
      const ok = geos.every((_, i) => Math.abs(Math.hypot(x - touches[i][0], y - touches[i][1]) - r) < 1e-6 * (1 + r));
      if (!ok) continue;
      if (out.some((o) => Math.hypot(o.centre[0] - x, o.centre[1] - y) < 1e-7 && Math.abs(o.radius - r) < 1e-7)) continue;
      out.push({ centre: [x, y], radius: r, touches });
    }
  }
  return out;
}

/** The solution whose center is nearest the pointer, or null. */
export function nearestSolution(solutions: TangentSolution[], pointer: Pt): TangentSolution | null {
  let best: TangentSolution | null = null;
  let gap = Infinity;
  for (const o of solutions) {
    const d = Math.hypot(o.centre[0] - pointer[0], o.centre[1] - pointer[1]);
    if (d < gap) [best, gap] = [o, d];
  }
  return best;
}

/** Add the circle (or, as an arc between its two touching points, `asArc`) tangent to the curves; a message when none exists.
 *  `radius` is the card's radius for two curves (kept as a dimension), null for three. */
export function addTangentCircle(s: M.SketchData, ids: number[], radius: number | null, pointer: Pt, asArc = false): M.SketchData | string {
  if (radius !== null && !(radius > 0)) return "Type a radius above zero in the sketch card";
  const found = nearestSolution(tangentCircles(s, ids, radius), pointer);
  if (!found) return radius === null ? "No circle touches those three curves" : "No circle of that radius touches both curves; try a larger radius";
  const points = [...s.points];
  const entities = [...s.entities];
  const constraints = [...s.constraints];
  let id = M.nextId(s);
  const point = (p: Pt) => {
    points.push({ id, u: p[0], v: p[1] });
    return id++;
  };
  const centre = point(found.centre);
  const circle = id++;
  if (!asArc) {
    entities.push({ id: circle, type: "circle", center: centre, radius: found.radius });
  } else {
    // The arc runs the short way from one touching point to the other, counterclockwise as stored.
    const [t0, t1] = found.touches;
    const turn = (t0[0] - found.centre[0]) * (t1[1] - found.centre[1]) - (t0[1] - found.centre[1]) * (t1[0] - found.centre[0]);
    const [from, to, fromCurve, toCurve] = turn >= 0 ? [t0, t1, ids[0], ids[1]] : [t1, t0, ids[1], ids[0]];
    const a = point(from);
    const b = point(to);
    entities.push({ id: circle, type: "arc", center: centre, start: a, end: b });
    constraints.push({ id: id++, type: "point_on", point: a, entity: fromCurve, auto: true }, { id: id++, type: "point_on", point: b, entity: toCurve, auto: true });
  }
  for (const curve of ids) constraints.push({ id: id++, type: "tangent", entities: [circle, curve], auto: true });
  if (radius !== null) constraints.push({ id: id++, type: "radius", entity: circle, value: radius });
  return { ...s, points, entities, constraints };
}

export type TangentTool = "tancircle" | "tanarc";

/** One click of the Tangent circle / Tangent arc between curves tools. Curves are picked one after another: Tangent circle makes the circle at the third curve,
 *  or (after two) at a click on empty space with the card's radius; Tangent arc takes two curves and then a click anywhere to choose the side. `uv` is the click. */
export function pickTangent(s: M.SketchData, picks: number[], hit: M.SketchSel | null, uv: Pt, tool: TangentTool, radius: number): { picks: number[]; made?: M.SketchData | string; message?: string } {
  const curve = hit && hit.kind === "entity" && isCurve(s.entities.find((e) => e.id === hit.id)) ? hit.id : null;
  const needTwo = tool === "tanarc";
  if (picks.length >= 2 && (needTwo || curve === null)) return { picks: [], made: addTangentCircle(s, picks.slice(0, 2), radius, uv, needTwo) };
  if (curve === null) return { picks, message: needTwo ? "Pick two lines, arcs or circles" : "Pick two or three lines, arcs or circles" };
  if (picks.includes(curve)) return { picks };
  const next = [...picks, curve];
  if (next.length === 3) return { picks: [], made: addTangentCircle(s, next, null, uv) };
  return { picks: next, message: next.length === 1 ? "Now pick the second curve" : needTwo ? "Now click where the arc goes" : "Pick a third curve, or click empty space for a circle of the card's radius there" };
}
