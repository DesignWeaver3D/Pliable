/** The base and destination point picks of a tool form: for tools that place a new shape, and for tools that move by a vector. */
import { moveVector, offsetOf, originFor, pointText, type Vec3 } from "./placepick.ts";
import { showNumber } from "./precision.ts";
import { fieldNumber, fieldText } from "./numberfield.ts";
import type { FormParts } from "./toolformparts.ts";

/** Pick base point and Pick destination point for a tool that places a shape (its `placement` fields). */
export function placementPicks(f: FormParts) {
  const { tool, inputs, buttons } = f;
  const placement = tool.placement;
  if (placement && placement.length === 3 && f.host.pickPoint) {
    const note = document.createElement("div");
    note.className = "row";
    let destination: Vec3 | null = null;
    let offset: Vec3 = [0, 0, 0]; // the picked base point relative to the placement point; zero = the placement point itself
    let picked = false;
    const origin = (): Vec3 => placement.map((n) => fieldNumber(inputs[n]) ?? 0) as unknown as Vec3;
    const show = () => (note.textContent = `${picked ? "Base picked" : "Base: placement point"}${destination ? `, destination ${pointText(destination)}` : ""}`);
    show();
    f.baseNow = () => {
      if (!picked) return null;
      const at = origin();
      return [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
    };
    const place = () => {
      if (!destination) return;
      originFor(destination, offset).forEach((c, i) => (inputs[placement[i]].value = fieldText(showNumber(c, 4))));
      f.preview(0);
    };
    const pickDestination = async () => {
      const from = picked ? [0, 1, 2].map((i) => origin()[i] + offset[i]) : undefined;
      const point = await f.host.pickPoint!(from ? { from } : {});
      if (!point || !f.isOpen()) return;
      destination = [point[0], point[1], point[2]];
      show();
      place();
      f.host.showBase?.(null); // the move arrows now mark the base point
    };
    const pickBase = document.createElement("button");
    pickBase.textContent = "Pick base point";
    pickBase.title = "Click the point of the shape to place, such as a corner or its center. Then click where it goes.";
    pickBase.addEventListener("click", async () => {
      const list = f.host.anchors ? await f.host.anchors(tool, f.values()) : [];
      if (!f.isOpen()) return;
      const at = origin();
      const extra = list.map((a) => ({ point: [at[0] + a.offset[0], at[1] + a.offset[1], at[2] + a.offset[2]], label: a.label }));
      const point = await f.host.pickPoint!({ extra });
      if (!point || !f.isOpen()) return;
      offset = offsetOf([point[0], point[1], point[2]], at);
      picked = true;
      f.host.showBase?.(point);
      show();
      place();
      f.preview(0); // the arrows move to the base
      if (!destination) await pickDestination(); // a base alone moves nothing, so go straight on to the destination
    });
    const pick = document.createElement("button");
    pick.textContent = "Pick destination point";
    pick.title = "Click a vertex, edge, face center, hole center, axis or the origin; the base point goes there";
    pick.addEventListener("click", () => void pickDestination());
    for (const name of placement)
      inputs[name].addEventListener("input", () => {
        destination = null;
        show();
      });
    buttons.before(pickBase, pick, note);
  }
}

/** Pick base point and Pick destination point for a tool that moves by a vector (its `moveVector` fields). */
export function moveVectorPicks(f: FormParts) {
  const { tool, inputs, buttons } = f;
  const vector = tool.moveVector;
  if (vector && vector.length === 3 && f.host.pickPoint) {
    let base: Vec3 = [0, 0, 0];
    let destination: Vec3 | null = null;
    const note = document.createElement("div");
    note.className = "row";
    const show = () => (note.textContent = `Base ${pointText(base)}${destination ? `, destination ${pointText(destination)}` : ""}`);
    show();
    let picked = false;
    f.baseNow = () => {
      if (!picked) return null;
      const v = vector.map((n) => fieldNumber(inputs[n]) ?? 0);
      return [base[0] + v[0], base[1] + v[1], base[2] + v[2]];
    };
    const apply = () => {
      if (!destination) return;
      moveVector(base, destination).forEach((c, i) => (inputs[vector[i]].value = fieldText(showNumber(c, 4))));
      f.preview(0);
    };
    const pickDestination = async () => {
      const point = await f.host.pickPoint!();
      if (!point || !f.isOpen()) return;
      destination = [point[0], point[1], point[2]];
      show();
      apply();
      f.host.showBase?.(null);
    };
    const pickBase = document.createElement("button");
    pickBase.textContent = "Pick base point";
    pickBase.title = "Click the point to move from, such as a vertex or the origin. Then click where it goes.";
    pickBase.addEventListener("click", async () => {
      const point = await f.host.pickPoint!();
      if (!point || !f.isOpen()) return;
      base = [point[0], point[1], point[2]];
      picked = true;
      f.host.showBase?.(point);
      show();
      apply();
      f.preview(0);
      if (!destination) await pickDestination(); // a base alone moves nothing, so go straight on to the destination
    });
    const pickDest = document.createElement("button");
    pickDest.textContent = "Pick destination point";
    pickDest.title = "Click where the base point goes; the move is the destination minus the base (the origin unless a base is picked)";
    pickDest.addEventListener("click", () => void pickDestination());
    for (const name of vector) inputs[name].addEventListener("input", () => ((destination = null), show()));
    buttons.before(pickBase, pickDest, note);
  }
}
