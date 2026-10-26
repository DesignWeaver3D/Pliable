/** The constraint row's drop lists: the strict variants sit under the smart button they refine (Horizontal distance and Vertical
 *  distance under Dimension; Horizontal and Vertical under Horizontal / vertical). A plain click on the button keeps the smart behavior.
 *  Every grouped option stays a constraint option, so its hotkey and `chooseConstraint(label)` still reach it. No DOM. */
export const CONSTRAINT_GROUPS: Record<string, string[]> = {
  Dimension: ["Horizontal distance", "Vertical distance"],
  "Horizontal / vertical": ["Horizontal", "Vertical"],
};

export interface StripChoice {
  label: string;
  enabled: boolean;
  /** The drop list under this button, when it has one. */
  menu?: { label: string; enabled: boolean }[];
}

/** The buttons of the constraint row: the grouped options leave the row and become the drop list of their group's button. */
export function stripChoices(all: { label: string; enabled: boolean }[]): StripChoice[] {
  const grouped = new Set(Object.values(CONSTRAINT_GROUPS).flat());
  return all
    .filter((c) => !grouped.has(c.label))
    .map((c) => {
      const members = CONSTRAINT_GROUPS[c.label];
      return members ? { ...c, menu: members.map((m) => all.find((x) => x.label === m)).filter((x): x is { label: string; enabled: boolean } => !!x) } : c;
    });
}
