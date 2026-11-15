/** The frame and pivot picks of a tool form that moves and tilts a part in a chosen frame (Stretch): Pick face, Pick edge and Pick pivot buttons; the
 *  fields they fill and the ones that only matter for another choice are not shown. */
import { showNumber } from "./precision.ts";
import { fieldNumber, fieldText } from "./numberfield.ts";
import type { FormParts } from "./toolformparts.ts";

const HIDDEN_ALWAYS = ["fx", "fy", "fz", "frame_edge"]; // set by the Pick face and Pick edge buttons
const FREE_ONLY = ["fa", "fb", "fc"]; // the free frame's turn angles
const PIVOT_POINT = ["px", "py", "pz"]; // the picked pivot

export function framePicks(f: FormParts) {
  const { tool, inputs, rowOf } = f;
  if (!(tool.params.some((p) => p.name === "frame_edge") && tool.params.some((p) => p.name === "pz"))) return;
  const set = (name: string, value: number) => {
    if (inputs[name]) inputs[name].value = fieldText(value);
  };
  const button = (text: string, hint: string, run: () => Promise<boolean>) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = hint;
    b.style.cssText = "text-align:center;margin-top:2px";
    b.addEventListener("click", async () => {
      if (!(await run()) || !f.isOpen()) return;
      showChoice();
      f.preview(0);
    });
    return b;
  };
  const frameButtons = document.createElement("div");
  frameButtons.style.cssText = "display:flex;gap:4px";
  const pickFace = button("Pick face", "Click a flat face anywhere on the model: the arrows and rings follow it (its normal is the frame's Z axis)", async () => {
    const plane = await f.host.pickPlane?.();
    if (!plane) return false;
    plane.normal.forEach((v, i) => set(["fx", "fy", "fz"][i], v));
    set("frame_edge", -1);
    set("frame", 1);
    return true;
  });
  const pickEdge = button("Pick edge", "Click a straight edge (its line is the frame's Z axis) or a circular edge (the circle's axis) anywhere on the model", async () => {
    const id = await f.host.pickEdgeId?.();
    if (id === null || id === undefined || id < 0) return false;
    set("frame_edge", id);
    set("frame", 1);
    return true;
  });
  frameButtons.append(pickFace, pickEdge);
  const pickPivot = button("Pick pivot", "Click a point anywhere on the model: the tilt turns about it (the default is the center of the selected part)", async () => {
    const point = await f.host.pickPoint?.();
    if (!point) return false;
    point.forEach((v, i) => (inputs[PIVOT_POINT[i]].value = fieldText(showNumber(v, 4))));
    set("pivot", 1);
    return true;
  });
  // Each button sits under the list it sets.
  rowOf.frame?.after(frameButtons);
  rowOf.pivot?.after(pickPivot);
  function showChoice() {
    const frame = fieldNumber(inputs.frame) ?? 0;
    const pivot = fieldNumber(inputs.pivot) ?? 0;
    const edge = (fieldNumber(inputs.frame_edge) ?? -1) >= 0;
    pickFace.classList.toggle("active", frame === 1 && !edge);
    pickEdge.classList.toggle("active", frame === 1 && edge);
    pickPivot.classList.toggle("active", pivot === 1);
    for (const name of HIDDEN_ALWAYS) rowOf[name]?.style.setProperty("display", "none");
    for (const name of FREE_ONLY) rowOf[name]?.style.setProperty("display", frame === 2 ? "" : "none");
    for (const name of PIVOT_POINT) rowOf[name]?.style.setProperty("display", pivot === 1 ? "" : "none");
  }
  for (const name of ["frame", "pivot"]) inputs[name]?.addEventListener("change", showChoice);
  showChoice();
}
