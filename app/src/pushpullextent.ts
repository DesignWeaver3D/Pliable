/** The Push/Pull extents that end the pad without a typed distance: Up to face (a picked target), Up to last and Through all (no pick). Pure logic, no DOM:
 *  the state (pushpullstate.ts) keeps the choice and the card (pushpullcard.ts) shows the buttons. The core decides what each does (pushpull_upto.py, pushpull_reach.py). */
export type Reach = "last" | "through";

export const REACH_BUTTONS: readonly { id: Reach; label: string; title: string }[] = [
  { id: "last", label: "Up to last", title: "Pull to the last surface of the bodies in the way, ray by ray, ending flush on it. Adds material (Auto, Add or New body); the distance is ignored; not with Symmetric" },
  { id: "through", label: "Through all", title: "Pull through every body in the way to the model's farthest extent along the pull. Adds material (Auto, Add or New body); the distance is ignored; not with Symmetric" },
];

/** The request fields the chosen extent adds, and the Symmetric override: none while the extent is the typed distance. */
export function extentParams(upTo: number | null, reach: Reach | null): Record<string, number | string> {
  if (upTo !== null) return { target: upTo, symmetric: 0 };
  if (reach !== null) return { extent: reach, symmetric: 0 };
  return {};
}

/** True while an extent other than the typed distance is on (the distance is ignored and Symmetric is off). */
export function extentOn(upTo: number | null, reach: Reach | null): boolean {
  return upTo !== null || reach !== null;
}
