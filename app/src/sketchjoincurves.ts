/** Join: curves that connect end to end become one curve. Lines on one straight line become one line, arcs on one circle one arc (a whole circle when they close up), and open splines one
 *  spline through all their points. Constraints and dimensions that still hold for the joined curve are kept (as Split keeps them for its pieces); the rest go. No DOM. */
import { angleOf, mod, roundOf, TWO_PI } from "./sketchintersect.ts";
import { entityPoints, nextId, pointOf } from "./sketchdata.ts";
import type { SketchConstraint, SketchData, SketchEntity } from "./sketchdata.ts";

type Joinable = Extract<SketchEntity, { type: "line" | "arc" | "spline" }>;
/** A curve in chain order: where it starts and ends in that order. */
interface Link {
  e: Joinable;
  from: number;
  to: number;
  reversed: boolean;
}

const ends = (e: Joinable): [number, number] => (e.type === "line" ? [e.a, e.b] : e.type === "arc" ? [e.start, e.end] : [e.points[0], e.points[e.points.length - 1]]);

/** Points that are the same place: one point, or two held together by a Coincident constraint. */
function sameFn(s: SketchData): (p: number, q: number) => boolean {
  return (p, q) => p === q || s.constraints.some((c) => c.type === "coincident" && c.points?.includes(p) && c.points.includes(q));
}

/** Order the curves into one chain, each end meeting the next; null when they do not all connect. Arcs run counterclockwise, so they only meet end to start. */
function chainOf(items: Joinable[], same: (p: number, q: number) => boolean): Link[] | null {
  const directed = items[0].type === "arc";
  const link = (e: Joinable, reversed: boolean): Link => {
    const [a, b] = ends(e);
    return reversed ? { e, from: b, to: a, reversed } : { e, from: a, to: b, reversed };
  };
  const chain = [link(items[0], false)];
  const left = items.slice(1);
  for (let again = true; again && left.length; ) {
    again = false;
    for (let i = 0; i < left.length && !again; i++) {
      const tail = chain[chain.length - 1];
      const head = chain[0];
      for (const reversed of directed ? [false] : [false, true]) {
        const l = link(left[i], reversed);
        if (same(tail.to, l.from)) chain.push(l);
        else if (same(l.to, head.from)) chain.unshift(l);
        else continue;
        left.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  return left.length ? null : chain;
}

/** Whether the constraint's other curves and points make it still true for the joined curve. */
function stillApplies(s: SketchData, c: SketchConstraint, joined: Set<number>, keptEnds: Set<number>, kind: Joinable["type"]): boolean {
  if (c.type === "coincident" || c.type === "fixed") return true;
  if (c.entities?.every((x) => joined.has(x))) return false; // between the joined curves themselves
  const line = ["horizontal", "vertical", "parallel", "perpendicular", "angle", "collinear", "point_on", "point_line_distance", "symmetric"];
  const arc = ["radius", "diameter", "equal", "point_on"];
  if (c.type === "tangent") {
    // still tangent when the other curve touches the joined one at an end that stays
    const other = s.entities.find((x) => c.entities?.includes(x.id) && !joined.has(x.id));
    return kind !== "spline" && !!other && entityPoints(other).some((p) => keptEnds.has(p));
  }
  if (kind === "line") return line.includes(c.type);
  if (kind === "arc") return arc.includes(c.type);
  return false;
}

/** The sketch with the curves `ids` joined into one (it keeps the first curve's id), or a message saying why they cannot be. */
export function joinCurves(s: SketchData, ids: number[]): SketchData | string {
  const picked = [...new Set(ids)].map((id) => s.entities.find((e) => e.id === id));
  if (picked.length < 2 || picked.some((e) => !e)) return "Select two or more curves to join";
  if (picked.some((e) => e!.reference)) return "Projected model edges cannot be joined";
  const items = picked as SketchEntity[];
  if (items.some((e) => e.type !== "line" && e.type !== "arc" && e.type !== "spline")) return "Join works on lines, arcs and splines";
  const joinable = items as Joinable[];
  const kind = joinable[0].type;
  if (joinable.some((e) => e.type !== kind)) return "Select curves of one kind to join: lines with lines, arcs with arcs, splines with splines";
  if (joinable.some((e) => e.type === "spline" && e.closed)) return "A closed spline has no end to join";
  const same = sameFn(s);
  const chain = chainOf(joinable, same);
  if (!chain) return "The curves do not connect end to end (each must share an end point with the next)";
  const head = chain[0];
  const tail = chain[chain.length - 1];
  const closed = same(tail.to, head.from);
  const first = joinable[0];
  const construction = joinable.every((e) => e.construction);
  const keep = { ...(construction ? { construction: true } : {}) };
  let made: SketchEntity;
  const dropPoints = new Set<number>();

  if (kind === "line") {
    if (closed) return "The lines come back to where they started, so they do not lie on one straight line";
    const a = pointOf(s, head.from);
    const b = pointOf(s, tail.to);
    const length = Math.hypot(b.u - a.u, b.v - a.v);
    if (length < 1e-9) return "The lines do not lie on one straight line";
    const tol = 1e-6 * Math.max(1, length);
    const [du, dv] = [(b.u - a.u) / length, (b.v - a.v) / length];
    for (const l of chain) {
      const [p, q] = [pointOf(s, l.from), pointOf(s, l.to)];
      const off = (r: { u: number; v: number }) => Math.abs((r.u - a.u) * dv - (r.v - a.v) * du);
      if (off(p) > tol || off(q) > tol) return "The lines do not lie on one straight line";
      if ((q.u - p.u) * du + (q.v - p.v) * dv < -tol) return "The lines fold back over each other";
    }
    made = { id: first.id, type: "line", a: head.from, b: tail.to, ...keep };
  } else if (kind === "arc") {
    const arcs = chain.map((l) => l.e as Extract<Joinable, { type: "arc" }>);
    const { c, r } = roundOf(s, arcs[0]);
    let sweep = 0;
    for (const arc of arcs) {
      const round = roundOf(s, arc);
      const tol = 1e-6 * Math.max(1, r);
      if (Math.hypot(round.c[0] - c[0], round.c[1] - c[1]) > tol || Math.abs(round.r - r) > tol) return "The arcs are not on one circle";
      sweep += mod(angleOf(round.c, [pointOf(s, arc.end).u, pointOf(s, arc.end).v]) - angleOf(round.c, [pointOf(s, arc.start).u, pointOf(s, arc.start).v])) || TWO_PI;
      if (arc.center !== arcs[0].center) dropPoints.add(arc.center);
    }
    if (sweep > TWO_PI + 1e-6) return "The arcs overlap each other";
    made = closed ? { id: first.id, type: "circle", center: arcs[0].center, radius: r, ...keep } : { id: first.id, type: "arc", center: arcs[0].center, start: head.from, end: tail.to, ...keep };
  } else {
    const points: number[] = [];
    for (const l of chain) {
      const list = l.reversed ? [...(l.e as Extract<Joinable, { type: "spline" }>).points].reverse() : [...(l.e as Extract<Joinable, { type: "spline" }>).points];
      points.push(...(points.length && same(points[points.length - 1], list[0]) ? list.slice(1) : list));
    }
    if (closed) points.pop();
    for (let i = 1; i < chain.length; i++) if (chain[i].from !== chain[i - 1].to) dropPoints.add(chain[i].from);
    if (closed && tail.to !== head.from) dropPoints.add(tail.to);
    made = { id: first.id, type: "spline", points, ...(closed ? { closed: true } : {}), ...keep };
  }

  const joined = new Set(joinable.map((e) => e.id));
  if (kind !== "spline") for (const l of chain) [l.from, l.to].forEach((p) => dropPoints.add(p));
  const keptEnds = new Set(entityPoints(made));
  for (const p of keptEnds) dropPoints.delete(p);
  const entities = s.entities.filter((e) => !joined.has(e.id) || e.id === first.id).map((e) => (e.id === first.id ? made : e));
  const constraints: SketchConstraint[] = [];
  const seen = new Set<string>();
  const remap = (x: number) => (joined.has(x) ? first.id : x);
  for (const c of s.constraints) {
    const names = c.entity !== undefined ? joined.has(c.entity) : c.entities?.some((x) => joined.has(x)) ?? false;
    if (!names) {
      constraints.push(c);
      continue;
    }
    if (!stillApplies(s, c, joined, keptEnds, kind)) continue;
    const moved: SketchConstraint = { ...c, ...(c.entity !== undefined ? { entity: remap(c.entity) } : {}), ...(c.entities ? { entities: c.entities.map(remap) } : {}) };
    const key = [moved.type, moved.entity, ...(moved.entities ?? []).slice().sort(), ...(moved.points ?? []), moved.point].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    constraints.push(moved);
  }
  // the points that were only the joints (or the extra arc centers) go with the constraints on them; one another curve still uses stays
  const used = new Set(entities.flatMap(entityPoints));
  const gone = new Set([...dropPoints].filter((p) => !used.has(p)));
  const names = (c: SketchConstraint) => [...(c.points ?? []), ...(c.point !== undefined ? [c.point] : [])].some((p) => gone.has(p));
  const pruned: SketchData = { ...s, points: s.points.filter((p) => !gone.has(p.id)), entities, constraints: constraints.filter((c) => !names(c)) };
  // a joint another curve still ends at stays, held on the joined curve
  let id = nextId(pruned);
  const out = [...pruned.constraints];
  if (kind !== "spline") {
    const alive = new Set(pruned.points.map((p) => p.id));
    for (const p of dropPoints) {
      const used = pruned.entities.some((e) => e.id !== first.id && entityPoints(e).includes(p));
      if (alive.has(p) && used) out.push({ id: id++, type: "point_on", point: p, entity: first.id, auto: true });
    }
  }
  return { ...pruned, constraints: out };
}
