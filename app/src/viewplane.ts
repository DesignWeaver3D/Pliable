/** The sketch plane square to the camera ("sketch on the view plane"): through the point the camera orbits, facing the viewer, with the screen's right as its x axis. */

export interface ViewPlane {
  origin: number[];
  normal: number[];
  xdir: number[];
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** `position` is the camera, `target` the point it looks at and `right` the screen's rightward direction in the world. */
export function viewPlane(position: number[], target: number[], right: number[]): ViewPlane {
  const normal = unit(sub(position, target));
  const along = dot(right, normal);
  const xdir = unit([right[0] - normal[0] * along, right[1] - normal[1] * along, right[2] - normal[2] * along]);
  return { origin: [...target], normal, xdir };
}
