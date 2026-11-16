// A quick way from a Fillet/Chamfer form to Chamfer (two distances): the first face beside the first selected edge becomes
// the reference face, the typed distance becomes both distances, and the two-distance form opens on that face and the edges.
import type { CoreClient } from "./client.ts";
import type { Sel } from "./viewport.ts";
import type { ToolInfo } from "./tools.ts";

export interface TwoDistanceHost {
  core: CoreClient;
  tools: () => readonly ToolInfo[];
  selection: () => readonly Sel[];
  /** Select the items and open the tool's form with the values. */
  open(tool: ToolInfo, selection: Sel[], values: Record<string, number>): void;
  say(text: string, error: boolean): void;
}

/** Reopen as a chamfer measured on a face: `toolId` is Chamfer (two distances) or Chamfer (distance and angle). */
export async function switchToTwoDistances(host: TwoDistanceHost, distance: number, toolId = "chamfer_two_distances"): Promise<void> {
  const tool = host.tools().find((t) => t.id === toolId);
  const edges = host.selection().filter((s) => s.kind === "edge");
  if (!tool || edges.length === 0) return;
  try {
    const reply = await host.core.request<{ faces: number[] }>("edge_faces", { edge: edges[0].id });
    if (reply.faces.length === 0) throw new Error("That edge has no face beside it");
    const size = distance > 0 ? distance : 1;
    const face: Sel = { kind: "face", id: reply.faces[0] };
    if (toolId === "round_face") host.open(tool, [face], { distance: size }); // every edge of the face: the edges leave the selection
    else host.open(tool, [face, ...edges], toolId === "chamfer_two_distances" ? { first: size, second: size } : { distance: size });
  } catch (e) {
    host.say((e as Error).message, true);
  }
}
