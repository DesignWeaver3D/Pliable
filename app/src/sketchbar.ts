/**
 * The bar at the bottom of the view that starts a sketch: one "Sketch On Face" button (the face may be selected
 * before or after pressing it; curved and multi-face selections are unrolled automatically) and the three
 * world planes. A face that cannot be sketched on says why and offers the diagnostic report.
 */
import type { CoreClient } from "./client";
import { SKETCH_PLANES } from "./layout";
import type { SketchMode } from "./sketch";
import type { Sel } from "./viewport";

interface PlaneReply {
  plane: any;
  reference?: any;
  unwrapped?: boolean;
  distortion?: { max: number; note: string };
}

export interface SketchBarDeps {
  core: CoreClient;
  sketch: SketchMode;
  bar: HTMLElement;
  selection(): Sel[];
  status(text: string, error?: boolean): void;
  /** Open the diagnostics dialog (the same report as the top bar button). */
  diagnostics(): void;
}

export class SketchBar {
  /** True after the button was pressed with no face selected: the next face selected starts the sketch. */
  armed = false;
  private offset = 0; // distance of the next standard-plane sketch from the plane, along its normal
  private problem: string | null = null;
  private key = "";

  constructor(private readonly d: SketchBarDeps) {}

  /** The selection changed (or the sketch started or ended): start the sketch if armed and a face is now selected. */
  update() {
    const faces = this.d.selection().filter((s) => s.kind === "face");
    if (this.armed && faces.length && !this.d.sketch.active) {
      this.armed = false;
      void this.begin(faces.map((f) => f.id));
      return;
    }
    if (this.d.sketch.active) this.armed = false;
    this.render();
  }

  /** Start a sketch on the given faces: a flat face directly, anything else unrolled. */
  async begin(ids: number[]) {
    const { core, sketch } = this.d;
    this.problem = null;
    try {
      const reply = await core.request<PlaneReply>("sketch_plane", { faces: ids });
      sketch.start(reply.plane, reply.reference, reply.unwrapped ? ids : null, reply.distortion);
    } catch (e) {
      this.problem = (e as Error).message;
      this.d.status(`Cannot sketch on this selection: ${this.problem}`, true);
    }
    this.key = "";
    this.render();
  }

  private press() {
    const faces = this.d.selection().filter((s) => s.kind === "face");
    if (faces.length) return void this.begin(faces.map((f) => f.id));
    this.armed = !this.armed;
    this.problem = null;
    this.d.status(this.armed ? "Sketch On Face: click a face to sketch on (press the button again to cancel)" : "Sketch On Face cancelled");
    this.key = "";
    this.render();
  }

  render() {
    const { sketch, bar } = this.d;
    const faces = this.d.selection().filter((s) => s.kind === "face").length;
    const key = `${faces}|${sketch.active}|${this.armed}|${this.problem}`;
    if (key === this.key) return; // keep the buttons (and the offset box focus) when nothing relevant changed
    this.key = key;
    const onFace = document.createElement("button");
    onFace.textContent = this.armed ? "Sketch On Face: pick a face" : "Sketch On Face";
    onFace.disabled = sketch.active;
    onFace.classList.toggle("active", this.armed);
    onFace.title = "Start a 2D sketch on a face. Select the face first, or press this and then click the face. Curved faces and chains of faces are unrolled flat automatically";
    onFace.addEventListener("click", () => this.press());
    const parts: HTMLElement[] = [onFace];
    if (this.problem) {
      const why = document.createElement("span");
      why.textContent = `Cannot sketch on this: ${this.problem}`;
      why.style.color = "#ff6b6b";
      const report = document.createElement("button");
      report.textContent = "Copy diagnostic report";
      report.title = "Open the diagnostic report (it includes this failure) to copy into a bug report";
      report.addEventListener("click", () => this.d.diagnostics());
      parts.push(why, report);
    }
    const label = document.createElement("span");
    label.textContent = "or on";
    const offset = document.createElement("input");
    offset.type = "number";
    offset.step = "any";
    offset.value = String(this.offset);
    offset.title = "Offset of the sketch plane from XY, XZ or YZ along its normal";
    offset.style.width = "56px";
    offset.addEventListener("keydown", (e) => e.stopPropagation());
    offset.addEventListener("input", () => (this.offset = Number(offset.value) || 0));
    bar.replaceChildren(
      ...parts,
      label,
      ...SKETCH_PLANES.map((name) => {
        const b = document.createElement("button");
        b.textContent = name;
        b.title = `Start a 2D sketch on the ${name} plane through the origin (the offset box moves the plane)`;
        b.disabled = sketch.active;
        b.addEventListener("click", async () => {
          this.armed = false;
          const reply = await this.d.core.request<{ plane: any }>("sketch_plane", { plane: name, offset: this.offset });
          sketch.start(reply.plane);
          this.key = "";
          this.render();
        });
        return b;
      }),
      offset,
    );
  }
}
