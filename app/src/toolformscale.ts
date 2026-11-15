/** The form of Scale body: Uniform shows one factor; Non-uniform shows the X, Y and Z factors (the world axes). */
import { fieldNumber } from "./numberfield.ts";
import type { FormParts } from "./toolformparts.ts";

export function scaleChoice(f: FormParts) {
  const { tool, inputs, rowOf } = f;
  if (tool.id !== "scale_body") return;
  const label = rowOf.factor?.querySelector("span");
  const show = () => {
    const uneven = (fieldNumber(inputs.scaling) ?? 0) === 1;
    for (const name of ["factor_y", "factor_z"]) rowOf[name]?.style.setProperty("display", uneven ? "" : "none");
    if (label) label.textContent = uneven ? "Scale X" : "factor";
  };
  inputs.scaling?.addEventListener("change", show);
  show();
}
