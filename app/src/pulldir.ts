/** The direction a face is pushed or pulled along when it is not its own normal: the vector maths, and the one place that holds the
 *  chosen direction for the selected face. The arrow handle and the face drag both read it (see toolRequest in main.ts). */
export type Vec = [number, number, number];

/** A pull direction closer than this (cosine) to the face's own plane would make a sliver; the core refuses it too. */
export const MIN_PULL_COSINE = 0.1;

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function unit(v: Vec): Vec | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 1e-9 ? null : [v[0] / length, v[1] / length, v[2] / length];
}

/** The direction of a straight edge from its two end points, or null for a zero-length edge. */
export function edgeVector(a: Vec, b: Vec): Vec | null {
  return unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
}

/** The chosen direction turned to point out of the face (a picked edge has no sign of its own). */
export function outOf(direction: Vec, normal: Vec): Vec {
  return dot(direction, normal) >= 0 ? direction : [-direction[0], -direction[1], -direction[2]];
}

/** Whether a direction leaves the face at a usable angle. */
export function leavesFace(direction: Vec, normal: Vec): boolean {
  return Math.abs(dot(direction, normal)) >= MIN_PULL_COSINE;
}

/** Two unit vectors square to `direction` and to each other: the sides the tilt arcs sit on. Stable: the helper axis is the one least aligned with the direction. */
export function sideFrame(direction: Vec): [Vec, Vec] {
  const helper: Vec = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const first = unit(cross(helper, direction))!;
  return [first, unit(cross(direction, first))!];
}

/** `axis` made square to `direction` (the part of it that lies across the arrow), as a unit vector; any square one when it lies along the arrow. */
export function sideToward(direction: Vec, axis: Vec): Vec {
  const along = dot(axis, direction);
  const across = unit([axis[0] - along * direction[0], axis[1] - along * direction[1], axis[2] - along * direction[2]]);
  return across ?? sideFrame(direction)[0];
}

/** The direction tilted by `angle` (radians) toward `side` (a unit vector square to it): it stays in the plane of the two. */
export function tilted(direction: Vec, side: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [direction[0] * c + side[0] * s, direction[1] * c + side[1] * s, direction[2] * c + side[2] * s];
}

/** The tilt asked for by dragging `pixels` along the arc's side, for arrows `radiusPx` long, cut back until the face is still left at a usable angle. */
export function tiltFromDrag(direction: Vec, side: Vec, normal: Vec, pixels: number, radiusPx: number): Vec {
  let angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pixels / radiusPx));
  for (let i = 0; i < 40; i++) {
    const out = tilted(direction, side, angle);
    if (leavesFace(out, normal)) return out;
    angle *= 0.9;
  }
  return direction;
}

/** The angle between the chosen direction and the face normal, in degrees. */
export function angleFromNormal(direction: Vec, normal: Vec): number {
  return (Math.acos(Math.max(-1, Math.min(1, dot(direction, normal)))) * 180) / Math.PI;
}

/** What a click in the view means while the push/pull direction is being picked: the selected face itself goes back to its normal, a straight edge or a face gives its direction
 *  (turned to point out of the face), anything else is refused and the picker stays armed. */
export type PickResult = { kind: "reset" } | { kind: "set"; direction: Vec } | { kind: "refused" };

export function resolvePick(isSelectedFace: boolean, direction: Vec | null, normal: Vec | null): PickResult {
  if (isSelectedFace) return { kind: "reset" };
  if (!direction) return { kind: "refused" };
  return { kind: "set", direction: normal ? outOf(direction, normal) : direction };
}

/** The chosen direction of the selected face (null: the face normal). Reset whenever the selection changes. */
export class PullDirection {
  dir: Vec | null = null;
  /** The face's own normal, kept so the arrow can come back to it and tilts can be limited. */
  normal: Vec | null = null;
  onChange: () => void = () => {};
  /** Called when the direction is forgotten because the selection changed (the Push/Pull card follows). */
  onReset: () => void = () => {};

  set(direction: Vec | null) {
    this.dir = direction;
    this.onChange();
  }

  /** Forget the direction without telling anyone (the selection changed). */
  reset() {
    this.dir = null;
    this.normal = null;
    this.onReset();
  }

  /** The tool parameters that carry it: none for the normal. */
  params(): Record<string, number> {
    return this.dir ? { ux: this.dir[0], uy: this.dir[1], uz: this.dir[2] } : {};
  }
}

/** The direction for `degrees` typed on an arc: the face normal tilted that far toward the arc's side (negative: the other way along the arc), cut back until it still leaves the face at a usable angle. */
export function typedTilt(normal: Vec, side: Vec, degrees: number): Vec {
  let angle = Math.max(-90, Math.min(90, degrees)) * (Math.PI / 180);
  for (let i = 0; i < 60; i++) {
    const out = tilted(normal, side, angle);
    if (leavesFace(out, normal)) return out;
    angle *= 0.95;
  }
  return normal;
}

/** The tilt of `direction` along `side` as an angle in degrees from the face normal (the other arc's part of the tilt is not counted); `side` and `otherSide` are the two arcs' sides seen from the normal. */
export function tiltAlong(normal: Vec, side: Vec, direction: Vec | null): number {
  if (!direction) return 0;
  const across = dot(direction, normal);
  return across <= 0 ? 0 : (Math.atan2(dot(direction, side), across) * 180) / Math.PI;
}

/** The direction for `degrees` typed on one arc while the other arc keeps its angle: the current direction's tilt along `otherSide` stays, the tilt along `side` becomes `degrees`
 *  (positive: toward `side`; the caller flips the sign to follow the way the arc was pulled), cut back until the face is still left at a usable angle. */
export function typedTiltKeeping(normal: Vec, side: Vec, otherSide: Vec, current: Vec | null, degrees: number): Vec {
  const keep = tiltAlong(normal, otherSide, current) * (Math.PI / 180);
  const build = (typed: number): Vec => {
    const raw: Vec = [0, 1, 2].map((i) => normal[i] + Math.tan(typed) * side[i] + Math.tan(keep) * otherSide[i]) as Vec;
    return unit(raw) ?? normal;
  };
  let typed = Math.max(-89.9, Math.min(89.9, degrees)) * (Math.PI / 180);
  for (let i = 0; i < 80; i++) {
    const out = build(typed);
    if (leavesFace(out, normal)) return out;
    typed *= 0.95;
  }
  return normal;
}
