/**
 * The bar at the bottom of the view that starts a sketch: one "Sketch On Geometry" button (the face may be selected
 * before or after pressing it; curved and multi-face selections are unrolled automatically) and the three
 * world planes. A face that cannot be sketched on says why in the message bar at the top.
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
      this.d.status(`Cannot sketch on this selection: ${this.problem} (Copy diagnostics at the top has a report)`, true);
    }
    this.key = "";
    this.render();
  }

  /** Start a sketch on a plane the core builds from selected vertices, an edge and a vertex, or a face moved, turned or touched at a point. */
  private async beginThrough(request: Record<string, unknown>) {
    const { core, sketch } = this.d;
    this.problem = null;
    try {
      const reply = await core.request<PlaneReply>("sketch_plane", request);
      sketch.start(reply.plane, undefined, null);
    } catch (e) {
      this.problem = (e as Error).message;
      this.d.status(`Cannot sketch there: ${this.problem}`, true);
    }
    this.key = "";
    this.render();
  }

  private press() {
    const faces = this.d.selection().filter((s) => s.kind === "face");
    if (faces.length) return void this.begin(faces.map((f) => f.id));
    const edges = this.d.selection().filter((s) => s.kind === "edge");
    // One edge selected: the sketch plane is square to it, with its origin at the middle of the edge.
    if (edges.length === 1) return void this.beginThrough({ normal_to: edges[0].id, at: 0.5 });
    this.armed = !this.armed;
    this.problem = null;
    this.d.status(this.armed ? "Sketch On Geometry: click a face to sketch on (press the button again to cancel). Other ways to place a sketch appear when you select vertices or an edge" : "Sketch On Geometry cancelled");
    this.key = "";
    this.render();
  }

  render() {
    const { sketch, bar } = this.d;
    const faces = this.d.selection().filter((s) => s.kind === "face").length;
    const selected = this.d.selection();
    const vertices = selected.filter((s) => s.kind === "vertex").map((s) => s.id);
    const edges = selected.filter((s) => s.kind === "edge").map((s) => s.id);
    // The other ways to place a sketch plane, from what is selected: [label, tooltip, request].
    const ways: [string, string, () => Record<string, unknown>][] = [];
    const faceIds = selected.filter((s) => s.kind === "face").map((s) => s.id);
    if (!faces && vertices.length === 3 && !edges.length) ways.push(["Through 3 Points", "Sketch on the plane through the three selected vertices", () => ({ vertices })]);
    if (!faces && vertices.length === 1 && edges.length === 1) ways.push(["Through Edge And Point", "Sketch on the plane through the selected straight edge and vertex", () => ({ edge: edges[0], vertex: vertices[0] })]);
    if (faceIds.length === 1 && vertices.length === 1 && !edges.length) ways.push(["Tangent At Point", "Sketch on the plane touching the selected face at the selected vertex (a vertex on the face)", () => ({ tangent_face: faceIds[0], vertex: vertices[0] })]);
    const key = `${faces}|${sketch.active}|${this.armed}|${this.problem}|${ways.map((w) => w[0]).join()}|${faceIds}|${vertices}`;
    if (key === this.key) return; // keep the buttons when nothing relevant changed
    this.key = key;
    const onFace = document.createElement("button");
    onFace.textContent = this.armed ? "Sketch On Geometry: pick a face" : "Sketch On Geometry";
    onFace.disabled = sketch.active;
    onFace.classList.toggle("active", this.armed);
    onFace.title = "Start a 2D sketch on geometry of the model: a face (select it first, or press this and then click the face. curved faces and chains of faces are unrolled flat automatically), or select an edge (the sketch plane is square to it with its origin at the middle of the edge, for rail and path profiles), or three vertices, or an edge and a vertex for the other ways of placing a sketch";
    onFace.addEventListener("click", () => this.press());
    const parts: HTMLElement[] = [onFace];
    if (!sketch.active) {
      for (const [label, tip, request] of ways) {
        const here = document.createElement("button");
        here.textContent = `Sketch ${label}`;
        here.title = tip;
        here.addEventListener("click", () => void this.beginThrough(request()));
        parts.push(here);
      }
    }
    const label = document.createElement("span");
    label.textContent = "or on";
    bar.replaceChildren(
      ...parts,
      label,
      ...SKETCH_PLANES.map((name) => {
        const b = document.createElement("button");
        b.textContent = name;
        b.title = `Start a 2D sketch on the ${name} plane through the origin (move or turn it afterwards with the plane handles)`;
        b.disabled = sketch.active;
        b.addEventListener("click", async () => {
          this.armed = false;
          const reply = await this.d.core.request<{ plane: any }>("sketch_plane", { plane: name });
          sketch.start(reply.plane);
          this.key = "";
          this.render();
        });
        return b;
      }),
    );
  }
}
