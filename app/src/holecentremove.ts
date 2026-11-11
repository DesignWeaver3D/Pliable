/** Moving a hole by dragging its center dot: previews the Move hole tool (latest request wins) and commits on release. */
import type { CoreClient, MeshData } from "./client.ts";
import { LatestWins } from "./latestwins.ts";
import { showNumber } from "./precision.ts";
import type { Sel, Viewport } from "./viewport.ts";

type Offset = { x: number; y: number; z: number };
type CentreMove = { face: number; offset: Offset };

export interface HoleCentreMoveHost {
  viewport: Viewport;
  core: CoreClient;
  status: HTMLElement;
  /** The Move hole request for this hole face and offset, or null when the tool is not there. */
  request(face: number, offset: Offset): Record<string, unknown> | null;
  /** Show a mesh without committing it. */
  show(mesh: MeshData): void;
  committed(): MeshData | null;
  currentSels(): Sel[];
  setCommitted(mesh: MeshData, frame: boolean, sels: Sel[]): void;
  mappedSelection(mesh: MeshData): Sel[];
}

export function installHoleCentreMove(host: HoleCentreMoveHost) {
  const { core, status } = host;
  const centrePreviews = new LatestWins<CentreMove>(async ({ face, offset }, current) => {
    const req = host.request(face, offset);
    if (!req) return;
    try {
      const mesh = await core.request<MeshData>("tool_preview", req);
      if (!current()) return; // released or cancelled while this was computed
      host.show(mesh);
      status.classList.remove("error");
      status.textContent = `Move hole: ${showNumber(offset.x)}, ${showNumber(offset.y)}, ${showNumber(offset.z)}`;
    } catch (e) {
      if (!current()) return;
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  });
  host.viewport.onCentreDrag = async (face, offset, phase) => {
    if (phase === "move") {
      centrePreviews.push({ face, offset: { x: offset.x, y: offset.y, z: offset.z } });
      return;
    }
    await centrePreviews.cancel();
    const committed = host.committed();
    if (phase === "cancel") {
      if (committed) host.show(committed);
      return;
    }
    const req = host.request(face, { x: offset.x, y: offset.y, z: offset.z });
    if (!req) return;
    try {
      const mesh = await core.request<MeshData>("tool_commit", req);
      host.setCommitted(mesh, false, host.mappedSelection(mesh));
    } catch (e) {
      const now = host.committed();
      if (now) host.setCommitted(now, false, host.currentSels());
      status.textContent = (e as Error).message;
      status.classList.add("error");
    }
  };
}
