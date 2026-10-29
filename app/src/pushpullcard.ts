/** The Push/Pull card: opened whenever a push/pull drag starts or the Push/Pull button is clicked, at the right under the nav cube group like the other edit cards.
 *  Fields: distance, the mode buttons (highlighted like Pick plane), Flip, Symmetric, the two tilt values and the direction vector of the gizmo (linked to it like the
 *  Cut with plane form). It holds no model state: choices live in PushPullState, the direction in PullDirection, the tilts in PullGizmo. */
import { FLIP_TITLE, MODE_BUTTONS, SYMMETRIC_TITLE, type PushPullState } from "./pushpullstate.ts";
import { roundValue } from "./precision.ts";
import type { Vec } from "./pulldir.ts";

export interface PushPullCardHost {
  state: PushPullState;
  /** The direction the face is pushed along now (the chosen one, else the face normal), or null with no face. */
  direction(): Vec | null;
  /** The tilts along the red and green arcs in degrees, or null while the gizmo is not shown. */
  tilts(): [number, number] | null;
  setTilts(red: number | null, green: number | null): void;
  /** A direction typed into the vector fields. */
  setDirection(direction: Vec): void;
  /** A distance typed in the card: preview it; Apply commits it; Close drops it. */
  previewDistance(value: number): void;
  applyDistance(value: number): void;
  cancelDistance(): void;
  /** The card opened or closed (the measurement card may need to move aside). */
  changed?(): void;
}

const TILT_TITLES = ["The direction tilted toward the face's x axis (the red arc), in degrees from the face normal", "The direction tilted toward the face's y axis (the green arc), in degrees from the face normal"];

export class PushPullCard {
  private readonly modeButtons = new Map<string, HTMLButtonElement>();
  private readonly flipButton = document.createElement("button");
  private readonly symmetric = document.createElement("input");
  private readonly distance = document.createElement("input");
  private readonly tilt: HTMLInputElement[] = [document.createElement("input"), document.createElement("input")];
  private readonly vector: HTMLInputElement[] = [0, 1, 2].map(() => document.createElement("input"));
  private typedDistance = false;
  private shown = "";

  constructor(private readonly el: HTMLElement, private readonly host: PushPullCardHost) {
    const row = (label: string, title: string, ...inputs: HTMLElement[]) => {
      const r = document.createElement("label");
      r.className = "row";
      r.title = title;
      const name = document.createElement("span");
      name.textContent = label;
      r.append(name, ...inputs);
      return r;
    };
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Push/Pull";
    this.distance.type = "number";
    this.distance.step = "any";
    this.distance.addEventListener("input", () => {
      const v = Number(this.distance.value);
      this.typedDistance = this.distance.value !== "" && Number.isFinite(v);
      if (this.typedDistance) host.previewDistance(v);
    });
    const modes = document.createElement("div");
    modes.style.cssText = "display:flex;flex-wrap:wrap;gap:4px";
    for (const mode of MODE_BUTTONS) {
      const button = document.createElement("button");
      button.textContent = mode.label;
      button.title = mode.title;
      button.style.cssText = "text-align:center;margin-top:2px;width:calc(50% - 2px)";
      button.addEventListener("click", () => host.state.setChoice(mode.id));
      this.modeButtons.set(mode.id, button);
      modes.append(button);
    }
    const modeHead = document.createElement("div");
    modeHead.className = "row";
    modeHead.title = "How the pushed or pulled volume meets the bodies. New body: hold Alt while dragging";
    modeHead.textContent = "Mode";
    this.flipButton.textContent = "Flip";
    this.flipButton.title = FLIP_TITLE;
    this.flipButton.style.cssText = "text-align:center;margin-top:4px";
    this.flipButton.addEventListener("click", () => host.state.setFlip(!host.state.flip));
    this.symmetric.type = "checkbox";
    this.symmetric.addEventListener("change", () => host.state.setSymmetric(this.symmetric.checked));
    this.tilt.forEach((input, i) => {
      input.type = "number";
      input.step = "any";
      input.addEventListener("input", () => {
        const v = Number(input.value);
        if (input.value === "" || !Number.isFinite(v)) return;
        host.setTilts(i === 0 ? v : null, i === 1 ? v : null);
      });
    });
    this.vector.forEach((input) => {
      input.type = "number";
      input.step = "any";
      input.style.width = "52px";
      input.addEventListener("input", () => this.typedVector());
    });
    const vectorRow = row("Direction", "The direction the face is pushed along (x, y, z), turned to point out of the face. The target at the arrow's tip picks it from an edge", ...this.vector);
    vectorRow.style.gap = "4px";
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.title = "Commit the typed distance";
    apply.addEventListener("click", () => this.apply());
    const close = document.createElement("button");
    close.textContent = "Close";
    close.addEventListener("click", () => this.close());
    buttons.append(apply, close);
    // The card's own keys: Enter applies a typed distance, Escape closes; nothing here reaches the view's shortcuts.
    el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.apply();
      else if (e.key === "Escape") this.close();
    });
    el.replaceChildren(
      title,
      row("Distance (mm)", "How far the face moves along the arrow (negative: the other way). Type it, then Apply", this.distance),
      modeHead,
      modes,
      this.flipButton,
      row("Symmetric", SYMMETRIC_TITLE, this.symmetric),
      row("Tilt red arc (deg)", TILT_TITLES[0], this.tilt[0]),
      row("Tilt green arc (deg)", TILT_TITLES[1], this.tilt[1]),
      vectorRow,
      buttons,
    );
    host.state.onChange = () => this.sync(true);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open() {
    if (!this.el.hidden) return;
    this.el.hidden = false;
    this.sync(true);
    this.host.changed?.();
  }

  /** Close the card; a typed distance that was not applied is dropped. */
  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    if (this.typedDistance) this.host.cancelDistance();
    this.typedDistance = false;
    this.distance.value = "";
    this.host.changed?.();
  }

  private apply() {
    const v = Number(this.distance.value);
    if (!this.typedDistance || !Number.isFinite(v)) return;
    this.typedDistance = false;
    this.distance.value = "";
    this.host.applyDistance(v);
  }

  /** The distance a drag is at now (shown while the mouse sets it). */
  showDistance(value: number) {
    if (this.typedDistance || this.el.hidden) return;
    this.distance.value = String(roundValue(value));
  }

  /** A drag ended: forget the shown distance. */
  clearDistance() {
    this.typedDistance = false;
    this.distance.value = "";
  }

  private typedVector() {
    const v = this.vector.map((i) => Number(i.value));
    if (this.vector.some((i) => i.value === "") || v.some((n) => !Number.isFinite(n))) return;
    const length = Math.hypot(v[0], v[1], v[2]);
    if (length < 1e-9) return;
    this.host.setDirection([v[0] / length, v[1] / length, v[2] / length]);
  }

  /** Bring the fields up to date with the state and the gizmo. Fields being typed in are left alone. */
  sync(force = false) {
    if (this.el.hidden) return;
    const { state } = this.host;
    const tilts = this.host.tilts();
    const direction = this.host.direction();
    const signature = JSON.stringify([state.mode, state.choice, state.flip, state.symmetric, tilts, direction]);
    if (!force && signature === this.shown) return;
    this.shown = signature;
    for (const [id, button] of this.modeButtons) button.classList.toggle("active", state.mode === id);
    this.flipButton.classList.toggle("active", state.flip);
    this.symmetric.checked = state.symmetric;
    const put = (input: HTMLInputElement, n: number | undefined) => {
      if (document.activeElement !== input) input.value = n === undefined ? "" : String(roundValue(n));
    };
    put(this.tilt[0], tilts?.[0]);
    put(this.tilt[1], tilts?.[1]);
    this.vector.forEach((input, i) => put(input, direction?.[i]));
  }
}
