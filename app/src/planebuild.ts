// Ways to make a tool's plane in its form from picked geometry (beside Pick plane and the origin planes): three points,
// an edge and a point, or a flat face moved by an offset and turned by an angle. The core builds the plane (sketch_plane).

export interface PlaneBuildHost {
  pickItem?(kind: "vertex" | "edge" | "face", message: string): Promise<number | null>;
  planeFrom?(request: Record<string, unknown>): Promise<{ origin: number[]; normal: number[] } | null>;
}

/** The request for a plane through three picked vertices, or through a picked edge and vertex. */
export const threePointRequest = (vertices: number[]) => ({ vertices });
export const edgePointRequest = (edge: number, vertex: number) => ({ edge, vertex });
/** A face's plane moved `offset` along its normal and then turned `angle` degrees about the plane's x axis (blank or invalid counts as 0). */
export function faceShiftRequest(face: number, offset: string, angle: string) {
  const num = (text: string) => (Number.isFinite(parseFloat(text)) ? parseFloat(text) : 0);
  return { face, offset: num(offset), angle: num(angle) };
}

/** The controls; `still` says the form is still open after a pick, `use` fills the form with the plane. */
export function planeBuildControls(host: PlaneBuildHost, still: () => boolean, use: (origin: number[], normal: number[]) => void): HTMLElement[] {
  if (!host.pickItem || !host.planeFrom) return [];
  const pick = host.pickItem.bind(host);
  const build = async (request: Record<string, unknown>) => {
    const plane = await host.planeFrom!(request);
    if (plane && still()) use(plane.origin, plane.normal);
  };
  const make = (text: string, title: string, run: () => Promise<void>) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", run);
    return button;
  };
  const threePoints = make("Plane: 3 points", "Click three points (corners or ends of edges) to make the plane through them", async () => {
    const ids: number[] = [];
    for (const word of ["first", "second", "third"]) {
      const id = await pick("vertex", `Pick the ${word} point of the plane`);
      if (id === null) return;
      ids.push(id);
    }
    await build(threePointRequest(ids));
  });
  const edgePoint = make("Plane: edge + point", "Click a straight edge and then a point to make the plane through both", async () => {
    const edge = await pick("edge", "Pick a straight edge the plane contains");
    if (edge === null) return;
    const vertex = await pick("vertex", "Pick a point the plane passes through");
    if (vertex !== null) await build(edgePointRequest(edge, vertex));
  });
  const field = (label: string, title: string) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "0";
    input.size = 5;
    input.title = title;
    input.setAttribute("aria-label", label);
    return input;
  };
  const offset = field("Plane offset", "How far the new plane sits from the picked face, along its normal");
  const angle = field("Plane angle", "Degrees the new plane is turned about the picked face's x axis");
  const shifted = make("Plane: face offset/angle", "Click a flat face, then use the plane moved by the offset and turned by the angle on its right", async () => {
    const face = await pick("face", "Pick a flat face to offset or turn the plane from");
    if (face !== null) await build(faceShiftRequest(face, offset.value, angle.value));
  });
  return [threePoints, edgePoint, shifted, offset, angle];
}
