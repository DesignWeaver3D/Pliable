/** The axis picks of a tool form: a point on an edge to pivot about, and an edge or a global axis to turn around. */
import { showNumber } from "./precision.ts";
import { fieldNumber, fieldText } from "./numberfield.ts";
import type { FormParts } from "./toolformparts.ts";

/** Pick axis for a tool that pivots about a point on an edge (its `pickAxis` fields). */
export function axisPointPick(f: FormParts) {
  const { tool, inputs, buttons } = f;
  const axis = tool.pickAxis;
  if (axis && axis.length === 4 && (f.host.pickEdgePoint || f.host.pickPoint)) {
    const pickAxis = document.createElement("button");
    pickAxis.textContent = "Pick axis";
    pickAxis.title = "Click an edge anywhere on the model (the face's own edge or another): the face pivots about the plane through that edge, square to the pull direction (the default is the face's own centroid)";
    pickAxis.addEventListener("click", async () => {
      const point = await (f.host.pickEdgePoint ?? f.host.pickPoint)!();
      if (!point || !f.isOpen()) return;
      axis.slice(0, 3).forEach((name, i) => (inputs[name].value = fieldText(showNumber(point[i], 4))));
      inputs[axis[3]].value = "1"; // the choice list: picked point
      f.preview(0);
    });
    buttons.before(pickAxis);
  }
}

/** Pick axis and the X, Y and Z axis buttons for a tool that turns around an edge or a global axis (its `pickEdge` fields). */
export function edgeAxisPicks(f: FormParts) {
  const { tool, inputs, title } = f;
  const edgeAxis = tool.pickEdge;
  if (edgeAxis && edgeAxis.length === 2 && f.host.pickEdgeId) {
    const pickEdge = document.createElement("button");
    pickEdge.textContent = "Pick axis";
    pickEdge.title = "Click a straight edge (the axis is its line), a circular edge (the circle's axis) anywhere on the model, or a global axis";
    pickEdge.addEventListener("click", async () => {
      const id = await f.host.pickEdgeId!();
      if (id === null || !f.isOpen()) return;
      if (id <= -2) inputs[edgeAxis[1]].value = String(-2 - id); // a global axis: the choice list's X, Y or Z
      else {
        inputs[edgeAxis[0]].value = String(id);
        inputs[edgeAxis[1]].value = "3"; // the choice list: picked edge
      }
      showAxis();
      f.preview(0);
    });
    // Like the plane forms (Cut with plane): Pick axis first, centered, the three global axes in a row under it; the axis list and the edge id are not shown.
    pickEdge.style.textAlign = "center";
    const axisRow = document.createElement("div");
    axisRow.style.cssText = "display:flex;gap:4px";
    const axisButtons: HTMLButtonElement[] = [];
    ["X", "Y", "Z"].forEach((name, i) => {
      const button = document.createElement("button");
      button.textContent = `${name} axis`;
      button.title = `Use the global ${name} axis through the origin`;
      button.style.cssText = "text-align:center;margin-top:2px";
      button.addEventListener("click", () => {
        inputs[edgeAxis[1]].value = String(i);
        showAxis();
        f.preview(0);
      });
      axisButtons.push(button);
      axisRow.append(button);
    });
    // The button for the axis in use gets the orange border of an active button (Pick axis only once an edge has been picked).
    function showAxis() {
      const choice = fieldNumber(inputs[edgeAxis![1]]) ?? 0;
      axisButtons.forEach((button, i) => button.classList.toggle("active", choice === i));
      pickEdge.classList.toggle("active", choice === 3 && (fieldNumber(inputs[edgeAxis![0]]) ?? 0) >= 0);
    }
    showAxis();
    title.after(pickEdge, axisRow);
    for (const name of edgeAxis) (inputs[name]?.closest(".row") as HTMLElement | null)?.style.setProperty("display", "none");
  }
}
