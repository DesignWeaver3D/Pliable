/** Projecting faces and edges of the model into the open sketch: picking them in the view and adding their outlines. */
import * as M from "./sketchmodel.ts";
import type { Sel } from "./viewport.ts";
import { cancelBox } from "./sketchpointer.ts";
import { pushUndo } from "./sketchundo.ts";
import { resolveSketch } from "./sketchrefresh.ts";
import { renderSketch } from "./sketchrender.ts";
import { renderPanel } from "./sketchpanel.ts";
import type { SketchMode } from "./sketch.ts";

/** The Project button: start picking the faces and edges to project, or project what is picked so far. */
export async function toggleProjectPick(mode: SketchMode) {
  if (mode.projectPick === null) {
    mode.projectPick = [];
    mode.viewport.selectItems([]);
    mode.host.status("Project: click the faces and edges of the model to project (click again to remove one). Click Project again or press Enter to finish, Escape to cancel");
    renderPanel(mode);
    return;
  }
  await finishProjectPick(mode);
}

/** A click while picking: toggle the face or edge under the pointer. */
export function pickToProject(mode: SketchMode, e: PointerEvent) {
  const hit = mode.viewport.pickModelItem(e);
  if (!hit || mode.projectPick === null) return;
  const has = mode.projectPick.some((s) => s.kind === hit.kind && s.id === hit.id);
  mode.projectPick = has ? mode.projectPick.filter((s) => !(s.kind === hit.kind && s.id === hit.id)) : [...mode.projectPick, hit];
  mode.viewport.selectItems(mode.projectPick);
  mode.host.status(`Project: ${mode.projectPick.length} picked. Click Project again or press Enter to finish, Escape to cancel`);
  renderPanel(mode);
}

export function cancelProjectPick(mode: SketchMode, quiet = false) {
  mode.projectPick = null;
  mode.viewport.selectItems([]);
  if (!quiet) {
    mode.host.status("Project cancelled");
    renderPanel(mode);
  }
}

export async function finishProjectPick(mode: SketchMode) {
  const picked = mode.projectPick ?? [];
  if (!picked.length) return cancelProjectPick(mode);
  mode.projectPick = null;
  mode.viewport.selectItems([]);
  renderPanel(mode);
  await projectModel(mode, picked);
}

/** Flatten the picked faces and edges onto the sketch plane as fixed reference geometry the sketch can snap to. */
export async function projectModel(mode: SketchMode, picked: Sel[]) {
  try {
    const ref = await mode.core.request<{ points: M.SketchPoint[]; entities: M.SketchEntity[]; skipped?: { square: number; tilted_circles: number; other: number }; drawn?: { ellipses: number; splines: number; ellipse_arcs?: number } }>("sketch_project", { plane: mode.s.plane, faces: picked.filter((p) => p.kind === "face").map((p) => p.id), edges: picked.filter((p) => p.kind === "edge").map((p) => p.id) });
    if (!mode.active) return; // the sketch was left while the model was being projected
    const near = (a: M.SketchPoint, b: M.SketchPoint) => Math.hypot(a.u - b.u, a.v - b.v) < 1e-5;
    const known = mode.s.points.filter((p) => p.fixed);
    const entityKey = (e: M.SketchEntity) => JSON.stringify([e.type, ...M.entityPoints(e).map((id) => mode.s.points.find((p) => p.id === id)).map((p) => p && [Math.round(p.u * 1e4), Math.round(p.v * 1e4)])]);
    const have = new Set(mode.s.entities.filter((e) => e.reference).map(entityKey));
    pushUndo(mode);
    const map = new Map<number, number>();
    for (const p of ref.points) {
      const twin = known.find((k) => near(k, p));
      if (twin) map.set(p.id, twin.id);
      else {
        const id = M.nextId(mode.s);
        mode.s.points.push({ ...p, id });
        map.set(p.id, id);
      }
    }
    let added = 0;
    for (const e of ref.entities) {
      const mapped = { ...e, id: M.nextId(mode.s) } as M.SketchEntity;
      if (mapped.type === "line") (mapped.a = map.get(mapped.a)!), (mapped.b = map.get(mapped.b)!);
      else if (mapped.type === "circle") mapped.center = map.get(mapped.center)!;
      else if (mapped.type === "ellipse") (mapped.center = map.get(mapped.center)!), (mapped.major = map.get(mapped.major)!), mapped.start !== undefined && ((mapped.start = map.get(mapped.start)!), (mapped.end = map.get(mapped.end!)!));
      else if (mapped.type === "spline") mapped.points = mapped.points.map((q) => map.get(q)!);
      else (mapped.center = map.get(mapped.center)!), (mapped.start = map.get(mapped.start)!), (mapped.end = map.get(mapped.end)!);
      if (have.has(entityKey(mapped))) continue;
      mode.s.entities.push(mapped);
      added++;
    }
    resolveSketch(mode);
    renderSketch(mode);
    const sk = ref.skipped;
    const notes = [
      ref.drawn?.ellipses ? `${ref.drawn.ellipses} tilted circle${ref.drawn.ellipses === 1 ? "" : "s"} drawn as ellipses` : "",
      ref.drawn?.ellipse_arcs ? `${ref.drawn.ellipse_arcs} tilted arc${ref.drawn.ellipse_arcs === 1 ? "" : "s"} drawn as elliptical arcs` : "",
      ref.drawn?.splines ? `${ref.drawn.splines} curved edge${ref.drawn.splines === 1 ? "" : "s"} drawn as splines` : "",
      sk?.tilted_circles ? `${sk.tilted_circles} arc${sk.tilted_circles === 1 ? "" : "s"} seen edge-on not drawn, their end points are snappable` : "",
      sk?.other ? `${sk.other} curved edge${sk.other === 1 ? "" : "s"} of another kind skipped, their end points are snappable` : "",
      sk?.square ? `${sk.square} edge${sk.square === 1 ? "" : "s"} seen end-on shown as points` : "",
    ].filter(Boolean);
    mode.host.status(`${added ? `Projected ${added} model edge${added === 1 ? "" : "s"}` : "No new model edges to project"}${notes.length ? `. ${notes.join("; ")}` : ""}`, sk?.tilted_circles || sk?.other ? "warn" : false);
  } catch (e) {
    mode.host.status((e as Error).message, true);
  } finally {
    // Whatever happened above, the sketch must stay usable.
    mode.drag = null;
    mode.clickToggle = null;
    cancelBox(mode);
    if (mode.active) renderSketch(mode);
  }
}
