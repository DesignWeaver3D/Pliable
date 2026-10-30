/** What the Push/Pull card chooses: the mode (Auto, Add, Subtract, New body), Flip and Symmetric, and the Alt override. Pure state, no DOM: the card (pushpullcard.ts),
 *  the drag (itemdrag.ts) and the arrows (pushpullarrows.ts) all read it. The core decides what each mode does (docs/dev-notes.md, "Push/pull modes and ghost"). */
export type PushPullMode = "auto" | "add" | "subtract" | "new";

export const MODE_BUTTONS: readonly { id: PushPullMode; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Dragging along the arrow adds to every body it meets, dragging against it subtracts (also through empty space)" },
  { id: "add", label: "Add", title: "Always adds: the pushed or pulled volume fuses with the bodies it meets" },
  { id: "subtract", label: "Subtract", title: "Always subtracts: the pushed or pulled volume cuts the bodies it meets" },
  { id: "new", label: "New body", title: "Always makes a separate new body and never cuts or merges. New body: press Alt to switch it on or off" },
];

export const FLIP_TITLE = "Reverses which drag direction adds and which subtracts (the arrows swap color); it does not change the face's normal";
export const SYMMETRIC_TITLE = "Push and pull both ways from the face. Symmetric: hold Shift while dragging";

export class PushPullState {
  /** The mode chosen on the card (default Auto). */
  choice: PushPullMode = "auto";
  flip = false;
  /** The card's Symmetric box; Shift held in a drag adds to it (itemdrag.ts). */
  symmetric = false;
  /** Alt pressed once: New body until Alt is pressed again, then the choice comes back. */
  altOn = false;
  /** Called after any change, so the card and the arrows redraw. */
  onChange: () => void = () => {};

  /** The mode in force now: New body while the Alt toggle is on, else the chosen one. */
  get mode(): PushPullMode {
    return this.altOn ? "new" : this.choice;
  }

  setChoice(mode: PushPullMode) {
    this.choice = mode;
    this.onChange();
  }

  setFlip(flip: boolean) {
    this.flip = flip;
    this.onChange();
  }

  setSymmetric(on: boolean) {
    this.symmetric = on;
    this.onChange();
  }

  /** A press of Alt: switches New body on, the next press switches it off. */
  toggleAlt() {
    this.altOn = !this.altOn;
    this.onChange();
  }

  /** The tool was applied, cancelled or closed: Flip is off the next time (the arrow roles follow it). */
  reset() {
    if (!this.flip) return;
    this.flip = false;
    this.onChange();
  }

  /** The request fields the core reads (mode and flip; symmetric and the direction are added by the drag). */
  params(): Record<string, number | string | boolean> {
    return { mode: this.mode, flip: this.flip };
  }
}

/** The color role of each arrow: the arrow on the face-normal side adds unless Flip swaps the roles. */
export function arrowRoles(flip: boolean): { normalSide: "add" | "subtract"; oppositeSide: "add" | "subtract" } {
  return flip ? { normalSide: "subtract", oppositeSide: "add" } : { normalSide: "add", oppositeSide: "subtract" };
}
