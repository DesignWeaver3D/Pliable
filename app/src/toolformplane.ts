/** The plane picks of a tool form: a flat face, the origin planes, the datum planes, kept sketches and the plane builders. */
import { ORIGIN_PLANES, planeButtons } from "./planepicks.ts";
import { planeBuildControls } from "./planebuild.ts";
import { showNumber } from "./precision.ts";
import { fieldText } from "./numberfield.ts";
import type { FormParts } from "./toolformparts.ts";

/** Pick plane and the plane buttons for a tool that takes a plane (its `pickPlane` fields). */
export function planePicks(f: FormParts) {
  const { tool, inputs, buttons, title } = f;
  const planeNames = tool.pickPlane;
  if (planeNames && (planeNames.length === 7 || planeNames.length === 5) && f.host.pickPlane) {
    const usePlaneIn = (origin: number[], normal: number[]) => {
      if (planeNames.length === 7) {
        planeNames.slice(0, 3).forEach((name, i) => (inputs[name].value = fieldText(showNumber(origin[i], 4))));
        planeNames.slice(3, 6).forEach((name, i) => (inputs[name].value = fieldText(showNumber(normal[i], 6))));
        inputs[planeNames[6]].value = "4"; // the choice list: picked plane
      } else {
        // A plane given as a distance along its direction: position, nx, ny, nz and the axis choice (3 = the direction nx, ny, nz); tilts start again from the picked plane.
        const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        const n = normal.map((c) => c / length);
        inputs[planeNames[0]].value = fieldText(showNumber(n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2], 4));
        planeNames.slice(1, 4).forEach((name, i) => (inputs[name].value = fieldText(showNumber(n[i], 6))));
        inputs[planeNames[4]].value = "3";
        for (const tilt of ["tilt_u", "tilt_v"]) if (inputs[tilt]) inputs[tilt].value = "0";
      }
      f.preview(0);
    };
    const pickPlane = document.createElement("button");
    pickPlane.textContent = "Pick plane";
    pickPlane.title = "Click a flat face anywhere on the model to use its plane (use this when the tool was started with the wrong face selected)";
    pickPlane.addEventListener("click", async () => {
      const plane = await f.host.pickPlane!();
      if (plane && f.isOpen()) usePlaneIn(plane.origin, plane.normal);
    });
    if (planeNames.length === 5) {
      // The one-position plane forms (Cut with plane): Pick plane first, centered, the three origin planes in a row under it; the Axis field is not shown (the buttons and the direction fields set it).
      pickPlane.style.textAlign = "center";
      const originRow = document.createElement("div");
      originRow.style.cssText = "display:flex;gap:4px";
      planeButtons(f.host, usePlaneIn)
        .slice(0, ORIGIN_PLANES.length)
        .forEach((button, i) => {
          button.textContent = ORIGIN_PLANES[i].name;
          button.style.cssText = "text-align:center;margin-top:2px";
          originRow.append(button);
        });
      title.after(pickPlane, originRow);
      const axisRow = inputs[planeNames[4]]?.closest(".row") as HTMLElement | null;
      if (axisRow) axisRow.style.display = "none";
      for (const n of planeNames.slice(1, 4)) inputs[n].addEventListener("input", () => (inputs[planeNames[4]].value = "3"));
    }
    const datums = (f.host.datumPlanes?.() ?? []).map((d) => {
      const button = document.createElement("button");
      button.textContent = `Datum: ${d.name}`;
      button.title = `Use the datum plane ${d.name}`;
      button.addEventListener("click", () => usePlaneIn(d.plane.origin, d.plane.normal));
      return button;
    });
    buttons.before(...(planeNames.length === 5 ? [] : [pickPlane]), ...datums, ...planeButtons(f.host, usePlaneIn).slice(planeNames.length === 5 ? ORIGIN_PLANES.length : 0), ...planeBuildControls(f.host, () => f.isOpen(), usePlaneIn));
  }
}
