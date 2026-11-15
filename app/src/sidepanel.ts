/** The docked side panel on the right: full height under the top bar, always there unless the person hides it with its handle or key.
 *  It owns the room it takes (the `--dock-w` variable that the 3D view and the floating cards offset by), its remembered width and
 *  hidden state, and the header and body that tool contents are mounted into. Once hidden it stays hidden until asked for. */
import { clampDockWidth, DOCK_DEFAULT_PX, parseDockState, type DockState } from "./dockmath.ts";

const KEY = "pliable.dock";
const PLACEHOLDER = "Select something or choose a tool: its parameters appear here.";

export class SidePanel {
  readonly header: HTMLElement;
  readonly body: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly handle: HTMLElement;
  private state: DockState;
  private hadContent = false;
  /** Called when a tool form arrives while the panel is hidden (the caller says where the parameters went). */
  onHiddenContent: (() => void) | null = null;

  constructor(readonly root: HTMLElement, handle: HTMLElement, private onChange: () => void) {
    this.handle = handle;
    this.header = root.querySelector<HTMLElement>("#dockhead")!;
    this.body = root.querySelector<HTMLElement>("#dockbody")!;
    this.hint = document.createElement("div");
    this.hint.className = "dockhint";
    this.hint.textContent = PLACEHOLDER;
    this.body.append(this.hint);
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* no saved state */
    }
    this.state = parseDockState(raw);
    this.state.width = clampDockWidth(this.state.width, window.innerWidth);
    handle.addEventListener("click", () => this.toggle());
    this.installGrip(root.querySelector<HTMLElement>("#dockgrip")!);
    root.querySelector<HTMLElement>("#dockclose")?.addEventListener("click", () => this.toggle(false));
    window.addEventListener("resize", () => this.apply());
    new MutationObserver(() => this.showHint()).observe(this.body, { childList: true, attributes: true, attributeFilter: ["hidden"], subtree: true });
    this.apply(false); // the owner of the panel is not ready for its callback yet
  }

  get hidden(): boolean {
    return this.state.hidden;
  }

  /** The room the panel takes now, in pixels (0 while hidden). */
  get room(): number {
    return this.state.hidden ? 0 : this.state.width;
  }

  /** Show or hide the panel (no argument toggles). Only a person's action calls this; nothing opens it by itself. */
  toggle(show: boolean = this.state.hidden): void {
    this.state.hidden = !show;
    this.save();
    this.apply();
  }

  /** The placeholder shows only while nothing else is mounted and showing in the body. */
  private showHint(): void {
    const busy = [...this.body.children].some((c) => c !== this.hint && !(c as HTMLElement).hidden);
    if (this.hint.hidden !== busy) this.hint.hidden = busy; // set only on a change: setting it again would be a new mutation and loop this observer
    if (busy && !this.hadContent && this.state.hidden) this.onHiddenContent?.(); // something wants the panel but the person hid it: only say so, never open it
    this.hadContent = busy;
  }

  private apply(notify = true): void {
    this.state.width = clampDockWidth(this.state.width, window.innerWidth);
    const hidden = this.state.hidden;
    const px = this.room;
    document.documentElement.style.setProperty("--dock-w", `${px}px`);
    this.root.hidden = hidden;
    this.handle.setAttribute("aria-expanded", String(!hidden));
    this.handle.title = hidden ? "Show the parameters panel (Shift+T)" : "Hide the parameters panel (Shift+T)";
    this.showHint();
    if (notify) this.onChange();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* not remembered */
    }
  }

  /** Dragging the panel's inner edge sets the width, kept on this computer. */
  private installGrip(grip: HTMLElement): void {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => {
        this.state.width = clampDockWidth(window.innerWidth - m.clientX, window.innerWidth);
        this.apply();
      };
      const done = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", done);
        grip.removeEventListener("pointercancel", done);
        this.save();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", done);
      grip.addEventListener("pointercancel", done);
    });
    grip.addEventListener("dblclick", () => {
      this.state.width = DOCK_DEFAULT_PX;
      this.save();
      this.apply();
    });
  }
}
