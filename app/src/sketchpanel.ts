/** The sketch panel: where it sits and what it lists (tools options, constraints, messages and buttons). */
import * as THREE from "three";
import * as M from "./sketchmodel.ts";
import { buildConstraintList, buildToolOptions, button, el } from "./sketchpanelparts.ts";
import { numericField, fieldNumber, fieldText } from "./numberfield.ts";
import { uiIcon } from "./icons.ts";
import { freeMessage, freeParts } from "./sketchfreedom.ts";
import { guard, leave } from "./sketchleave.ts";
import { flipPlane, pickMoveFrom, pickMoveTo, showPlaneHandles } from "./sketchplanemove.ts";
import { offsetSelection, roundSelectedCorner, toggleConstruction, transformButtons } from "./sketchtransform.ts";
import { toggleProjectPick } from "./sketchproject.ts";
import { buildGrid, renderSketch } from "./sketchrender.ts";
import type { SketchMode } from "./sketch.ts";
import { keyNames } from "./platform.ts";

/** The card starts just under the nav cube group, so it has all the room below for a long constraint list. */
export function placePanel(mode: SketchMode) {
  const cube = document.getElementById("navcube")?.getBoundingClientRect();
  const top = cube && cube.height > 0 ? Math.round(cube.bottom) + 8 : 270;
  mode.panel.style.top = `${top}px`;
  mode.panel.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
}

export function renderPanel(mode: SketchMode) {
  placePanel(mode);
  const keepAsk = mode.panel.querySelector<HTMLElement>(".ask");
  const asking = keepAsk && !keepAsk.hidden;
  if (asking) return; // do not rebuild while a value is being typed
  mode.panel.hidden = false;

  const iconButton = (icon: string, title: string, on: () => void, pressed = false) => {
    const b = document.createElement("button");
    b.className = "iconbtn" + (pressed ? " active" : "");
    b.title = title;
    b.append(uiIcon(icon));
    b.addEventListener("click", on);
    return b;
  };
  const header = el("div", "head");
  if (mode.kept) header.title = `Editing ${mode.kept.name}`;
  const grid = iconButton("grid", mode.options.grid ? "Hide the grid" : "Show the grid (set its spacing in the sketch settings)", () => {
    mode.options.grid = !mode.options.grid;
    mode.saveOptions();
    buildGrid(mode);
    renderPanel(mode);
  }, mode.options.grid);
  const snap = iconButton("gridSnap", mode.options.snapGrid ? "Snap to grid is on: click to turn it off" : "Snap to grid: drawn points land on the grid spacing", () => {
    mode.options.snapGrid = !mode.options.snapGrid;
    mode.saveOptions();
    renderPanel(mode);
  }, mode.options.snapGrid);
  const look = iconButton("lookAt", "Turn the view square to the sketch plane in orthographic projection. Turning the camera afterwards goes back to the projection you had", () => mode.viewport.lookFromOrthographic(new THREE.Vector3(...M.frame(mode.s.plane).n)));
  const flip = iconButton("flipSketch", "Flip the sketch to the other side of its plane: the plane's normal reverses and the drawing stays where it is in space, then the view looks from the new side", () => void guard(mode, () => flipPlane(mode)));
  const gizmos = iconButton("gizmos", mode.gizmosShown ? "Hide the sketch plane's move and turn gizmos" : "Show the sketch plane's move and turn gizmos", () => {
    mode.gizmosShown = !mode.gizmosShown;
    showPlaneHandles(mode);
    renderPanel(mode);
  }, mode.gizmosShown);
  const base = iconButton("pickBase", "Pick base point: click the point the sketch plane moves from (a vertex, edge, face center, axis or the origin); then use Pick move to location", () => void pickMoveFrom(mode), mode.moveFrom !== null);
  const target = iconButton("pickTarget", "Pick move to location: click where the sketch plane goes (it moves by the offset from the base point, or from its own origin when none was picked)", () => void pickMoveTo(mode));
  const gear = iconButton("gear", "Sketch settings", () => mode.openSettings());
  gear.style.marginLeft = "auto";
  header.append(el("span", "title", mode.kept ? mode.kept.name : "Sketch"), gear);
  const icons = el("div", "head");
  icons.append(look, ...(mode.unwrapFace === null ? [flip] : []), gizmos, base, target, grid, snap);
  const status = el("div", "dof", mode.failed.size ? `Conflict: ${mode.s.constraints.filter((c) => mode.failed.has(c.id)).map((c) => M.describeConstraint(mode.s, c)).join("; ") || [...mode.failed].join(", ")}. Remove one (red rows below)` : mode.dof === null ? "" : mode.dof === 0 ? "Fully constrained" : `${mode.dof} degrees of freedom left`);
  if (mode.failed.size) status.classList.add("bad");
  else if (mode.dof) {
    status.classList.add("link");
    status.title = "Click to light up (in yellow) the points and curves that still have freedom";
    status.addEventListener("click", () => {
      mode.showFree = !mode.showFree;
      if (mode.showFree) mode.status(freeMessage(freeParts(mode.s, mode.freedom, mode.freeSizes), mode.dof));
      renderSketch(mode);
    });
  }

  const tools = buildToolOptions(mode);

  // The constraint and dimension buttons live in the strip at the top; the card keeps the other selection tools.
  const constraintsBox = el("div", "section");
  constraintsBox.append(el("div", "group", mode.selection.length ? "Selection" : "Select items to edit"));

  const transformRow = transformButtons(mode);
  const transformBox = el("div", "section");
  if (transformRow) transformBox.append(el("div", "group", "Edit selection"), transformRow);
  const ask = el("div", "ask");
  ask.hidden = true;

  const list = buildConstraintList(mode);

  if (mode.selection.some((x) => x.kind === "point")) {
    const size = document.createElement("input");
    numericField(size);
    size.value = fieldText(mode.rectOptions.size);
    size.title = "Corner radius or bevel size";
    size.addEventListener("keydown", (e) => e.stopPropagation());
    size.addEventListener("input", () => (mode.rectOptions.size = Math.abs(fieldNumber(size) ?? 0)));
    const cornerRow = el("div", "row-buttons");
    cornerRow.append(button("Round corner", () => roundSelectedCorner(mode, "fillet")), button("Bevel corner", () => roundSelectedCorner(mode, "chamfer")), size);
    constraintsBox.append(cornerRow);
  }

  if (mode.selection.some((x) => x.kind === "entity")) {
    const distance = document.createElement("input");
    numericField(distance);
    distance.value = fieldText(mode.offset.distance);
    distance.title = "Offset distance (negative shrinks a closed outline)";
    distance.addEventListener("keydown", (e) => e.stopPropagation());
    distance.addEventListener("input", () => (mode.offset.distance = fieldNumber(distance) ?? 0));
    const offsetRow = el("div", "row-buttons");
    offsetRow.append(button("Offset", () => offsetSelection(mode)), distance);
    constraintsBox.append(offsetRow);
    const construction = button("Toggle construction", () => toggleConstruction(mode));
    construction.title = keyNames("Construction geometry guides the sketch but is not part of the profile. Pressing Alt does the same for the selected curves");
    constraintsBox.append(construction);
  }

  const flat = mode.unwrapFace === null;
  const picking = mode.projectPick !== null;
  const project = button(picking ? `Project ${mode.projectPick!.length} picked: done` : "Project model edges", () => void guard(mode, () => toggleProjectPick(mode)));
  project.classList.toggle("active", picking);
  project.title = picking ? "Project the picked faces and edges now (Enter), or press Escape to cancel" : "Pick faces and edges of the model, then flatten them onto this plane as fixed geometry to snap and constrain to";
  if (flat) constraintsBox.append(project);

  const finish = button("Finish sketch", () => void guard(mode, () => mode.finish()));
  finish.title = "Leave the sketch and keep it in the list of sketches. It stays separate from the model; its closed regions show as profile faces you can extrude";
  const exit = button(mode.kept ? "Discard changes" : "Discard sketch", () => void guard(mode, () => leave(mode)));
  exit.title = mode.kept ? "Leave the sketch without saving what you changed" : "Leave the sketch and throw it away without changing the model";
  const leaving = el("div", "row-buttons");
  leaving.append(finish, exit);
  mode.panel.replaceChildren(header, icons, leaving, status, tools, constraintsBox, ...(transformRow ? [transformBox] : []), ask, list);
}
