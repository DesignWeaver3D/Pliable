/** The helper buttons of the tool strip that grow a selection (faces to edges, an edge to its loop, ring or sharp
 *  chain) and the one that reopens a primitive. Moved out of main.ts. */
import type { MeshData } from "./client";
import type { Sel } from "./viewport";
import { bodiesOf } from "./visibility";

export interface HelperDeps {
  core: { request<T>(type: string, params?: Record<string, unknown>): Promise<T> };
  status: HTMLElement;
  committed(): MeshData | null;
  selection(): Sel[];
  /** Select items in the view and tell the page about the new selection. */
  select(sels: Sel[]): void;
  editPrimitive(id: number): void;
  /** The angle (degrees) that makes an edge sharp, from the settings. */
  sharpAngle(): number;
}

/** Which selection helper buttons apply to the current selection (also the toolbar cache key). */
export function helperSignature(d: HelperDeps): string {
  const sels = d.selection();
  const committed = d.committed();
  if (sels.length === 1 && sels[0].kind === "body") {
    const id = sels[0].id;
    return `body${id}${committed ? bodiesOf(committed).find((b) => b.id === id)?.editable : ""}`;
  }
  if (sels.length === 1) return `${sels[0].kind}${sels[0].id}`;
  if (sels.length > 1 && sels.every((s) => s.kind === "face")) return "faces" + sels.map((s) => s.id).join(",");
  return "";
}

/** Buttons that grow a selection of faces or an edge into a selection of edges. */
export function selectionHelpers(d: HelperDeps): HTMLButtonElement[] {
  const sels = d.selection();
  const committed = d.committed();
  const make = (label: string, title: string, request: Record<string, unknown>, none = "Nothing more to select") => {
    const button = document.createElement("button");
    button.textContent = label;
    button.title = title;
    button.className = "helper";
    button.addEventListener("click", async () => {
      try {
        const reply = await d.core.request<{ edges?: number[]; loops?: number[][] }>("edge_selection", request);
        const ids = reply.edges ?? (reply.loops ?? []).flat();
        const picked: Sel[] = ids.map((id) => ({ kind: "edge" as const, id }));
        d.select(picked);
        const same = picked.length === 1 && d.selection().length === 1 && "edge" in request;
        d.status.textContent = same ? `${label}: ${none}` : `${label}: ${picked.length} edge${picked.length === 1 ? "" : "s"} selected`;
      } catch (e) {
        d.status.textContent = (e as Error).message;
      }
    });
    return button;
  };
  const one = sels.length === 1 ? sels[0] : null;
  if (one?.kind === "body") {
    const body = committed ? bodiesOf(committed).find((b) => b.id === one.id) : undefined;
    if (!body?.editable) return [];
    const button = document.createElement("button");
    button.textContent = "Edit primitive";
    button.title = "Reopen the form and handles this body was made with";
    button.className = "helper";
    button.addEventListener("click", () => d.editPrimitive(one.id));
    return [button];
  }
  if (one?.kind === "face") {
    return [
      make("All edges", "Select every edge of the selected face, outline and holes", { mode: "face_edges", face: one.id }),
      make("Outline edges", "Select only the perimeter (outer) edges of the selected face, leaving out any holes", { mode: "face_outline", face: one.id }),
    ];
  }
  if (one?.kind === "edge") {
    return [
      make("Edge loops", "Select the closed outline of each face beside this edge (loops follow the shared faces, not an angle)", { mode: "edge_loops", edge: one.id }, "this edge has no outline beyond itself"),
      make("Edge ring", "Select the parallel edges across the faces on both sides of this edge, like the rungs of a ladder (needs four-sided faces)", { mode: "ring", edge: one.id }, "no ring: the faces beside it are not four-sided"),
      make("Sharp edges", `Select the connected edges where faces meet at ${d.sharpAngle()} degrees or more (change the angle in settings)`, { mode: "sharp", edge: one.id, angle: d.sharpAngle() }, "no connected sharp edges"),
    ];
  }
  if (sels.length > 1 && sels.every((s) => s.kind === "face")) {
    return [make("Region outline", "Select the edges around the outside of the selected faces", { mode: "region_boundary", faces: sels.map((s) => s.id) })];
  }
  return [];
}
