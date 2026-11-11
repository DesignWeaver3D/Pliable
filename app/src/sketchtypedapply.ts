/** Typed sizes while drawing: the labels of the fields a tool offers and applying what was typed. */
import * as M from "./sketchmodel.ts";
import * as T from "./sketchtyped.ts";
import { leaderAngle } from "./sketchleaderangle.ts";
import { placeClick } from "./sketchpointer.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";

/** The numbers the current drawing tool takes at this stage (empty when it takes none): typing starts an entry. */
export function typedLabels(mode: SketchMode): string[] {
  return mode.active ? T.typedLabels(mode.tool, mode.chain.length, !!mode.sidesOf(mode.tool)) : [];
}

/** Place the next points at the typed sizes in the pointer's direction and keep the typed sizes as dimensions where the shape has them. */
export async function applyTyped(mode: SketchMode) {
  const numbers = T.parseTyped(mode.typed);
  mode.typed = "";
  if (!numbers) return mode.host.status("That is not a positive size", true);
  const tool = mode.tool; // placing the last point can leave the tool
  const [w, h] = [numbers[0], numbers[1] ?? numbers[0]];
  const before = mode.s.entities.length;
  const pointer = mode.cursor; // placing the last point clears the cursor
  mode.placingTyped = true;
  try {
    for (const target of T.typedTargets(tool, mode.chain, mode.cursor, numbers.slice(0, typedLabels(mode).length))) placeClick(mode, { ...target });
  } finally {
    mode.placingTyped = false;
  }
  const made = mode.s.entities.slice(before);
  const plain = !made.some((x) => x.type === "arc"); // a rounded rectangle's sides are not its overall size
  let dimensions: Omit<M.SketchConstraint, "id">[] = [];
  if (tool === "line" && made[0]?.type === "line") dimensions = [{ type: "distance", entity: made[0].id, value: w }];
  else if (tool === "circle" && made[0]?.type === "circle") dimensions = [{ type: "diameter", entity: made[0].id, value: w, angle: leaderAngle(mode.s, made[0].id, "diameter", pointer) }];
  else if ((tool === "rectangle" || tool === "rectcentre") && plain && made.length >= 2) {
    dimensions = [{ type: "distance", entity: made[0].id, value: w }, { type: "distance", entity: made[1].id, value: h }];
  }
  for (const d of dimensions) {
    mode.s.constraints.push({ id: M.nextId(mode.s), ...d });
    if (!(await resolveSketch(mode))) {
      mode.s.constraints.pop(); // the typed size clashes with what the shape is tied to: keep the shape, drop the dimension
      await resolveSketch(mode);
      mode.host.status("The typed size conflicts with existing constraints, so only the shape was placed", true);
    }
  }
  renderSketch(mode);
}
