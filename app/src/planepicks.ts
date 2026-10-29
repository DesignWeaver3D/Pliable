// Extra ways to choose a tool's plane in its form (beside Pick plane and the datum plane buttons): the origin planes and
// the kept sketches. Also the colors of a cutting plane's two sides, shown on the names in the Remove side list.
import { bodyColor } from "./bodycolors";

export interface PickedPlane {
  origin: number[];
  normal: number[];
}

/** The origin planes with the normals the sketch planes use (XZ looks along -Y). */
export const ORIGIN_PLANES: readonly { name: string; plane: PickedPlane }[] = [
  { name: "XY", plane: { origin: [0, 0, 0], normal: [0, 0, 1] } },
  { name: "XZ", plane: { origin: [0, 0, 0], normal: [0, -1, 0] } },
  { name: "YZ", plane: { origin: [0, 0, 0], normal: [1, 0, 0] } },
];

export interface PlaneSource {
  /** The kept sketches (id and name). */
  sketchList?(): readonly { id: number; name: string }[];
  /** The plane a kept sketch lies in (null when it cannot be read). */
  sketchPlane?(id: number): Promise<PickedPlane | null>;
}

/** The buttons that set the plane from an origin plane or a kept sketch; `use` fills the form. */
export function planeButtons(source: PlaneSource, use: (origin: number[], normal: number[]) => void): HTMLButtonElement[] {
  const make = (text: string, title: string, run: () => void) => {
    const button = document.createElement("button");
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", run);
    return button;
  };
  const origins = ORIGIN_PLANES.map((o) => make(`Origin: ${o.name}`, `Use the ${o.name} origin plane`, () => use(o.plane.origin, o.plane.normal)));
  const sketches = (source.sketchList?.() ?? []).map((s) =>
    make(`Sketch: ${s.name}`, `Use the plane of the sketch ${s.name}`, async () => {
      const plane = await source.sketchPlane?.(s.id);
      if (plane) use(plane.origin, plane.normal);
    }),
  );
  return [...origins, ...sketches];
}

/** Color the names in the Remove side list: Side 1 and Side 2 like the bodies they would give (`sides` from the preview), None unchanged. */
export function colourSides(list: HTMLSelectElement, sides: readonly (number | null)[] | undefined) {
  const paint = () => {
    list.style.color = list.options[list.selectedIndex]?.style.color ?? "";
  };
  [1, 2].forEach((index) => {
    const id = sides?.[index - 1];
    if (list.options[index]) list.options[index].style.color = id === null || id === undefined ? "" : bodyColor(id);
  });
  if (!list.dataset.sideColours) {
    list.dataset.sideColours = "1";
    list.addEventListener("change", paint);
  }
  paint();
}
