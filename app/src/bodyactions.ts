/** The bodies list and what it does: hide, isolate, see-through, focus, duplicate, delete, rename, select. Moved out of
 *  main.ts; it reads the view state in appstate.ts and gets what else it needs from the page as arguments. */
import { bodyView } from "./appstate";
import { BodyList } from "./bodylist";
import { toggleFocus, toggleGhost, toggleHidden, toggleIsolated } from "./bodylogic";
import type { MeshData } from "./client";
import type { Sel } from "./viewport";
import { bodiesOf } from "./visibility";

export interface BodyActionDeps {
  core: { request<T>(type: string, params?: Record<string, unknown>): Promise<T> };
  status: HTMLElement;
  list: HTMLElement;
  count: HTMLElement;
  /** The newest committed mesh and the current selection. */
  committed(): MeshData | null;
  selection(): Sel[];
  /** Draw a mesh (the hidden and see-through sets are applied by it). */
  show(mesh: MeshData): void;
  setCommitted(mesh: MeshData, frame: boolean, sels: Sel[]): void;
  /** Select items in the view, then tell the page about the new selection. */
  select(sels: Sel[]): void;
  hover(sel: Sel | null): void;
  editPrimitive(id: number): void;
}

export function installBodyActions(d: BodyActionDeps) {
  /** The id of the body a selected item belongs to. */
  function ownerBody(s: Sel): number | null {
    const committed = d.committed();
    if (!committed) return null;
    if (s.kind === "body") return s.id;
    return (s.kind === "face" ? committed.faces : s.kind === "edge" ? committed.edges : committed.vertices).find((x) => x.id === s.id)?.body ?? null;
  }

  /** Redraw after the hidden set changed, dropping selected items that are no longer visible. */
  function applyVisibility() {
    const committed = d.committed();
    if (!committed) return;
    const keep = d.selection();
    d.show(committed);
    d.select(keep.filter((s) => !bodyView.hidden.has(ownerBody(s) ?? -1)));
  }

  /** H hides the body of the selection, Shift+H isolates it, Alt+H shows everything. */
  function setVisibility(action: "hide" | "isolate" | "show") {
    const committed = d.committed();
    if (!committed) return;
    const all = bodiesOf(committed).map((b) => b.id);
    const picked = new Set(d.selection().map(ownerBody).filter((id): id is number => id !== null));
    if (action === "show") bodyView.hidden = new Set();
    else if (picked.size) {
      bodyView.hidden = action === "isolate" ? new Set(all.filter((id) => !picked.has(id))) : new Set([...bodyView.hidden, ...picked]);
    }
    applyVisibility();
  }

  const fail = (e: unknown) => {
    d.status.textContent = (e as Error).message;
    d.status.classList.add("error");
  };

  function runBodyRequest(kind: "duplicate_body" | "delete_body", body: number) {
    d.core
      .request<MeshData>(kind, { body })
      .then((mesh) => d.setCommitted(mesh, false, []))
      .catch(fail);
  }

  const bodyList: BodyList = new BodyList(d.list, {
    toggleHide(id) {
      bodyView.hidden = toggleHidden(bodyView.hidden, id);
      applyVisibility();
    },
    toggleIsolate(id) {
      const committed = d.committed();
      if (!committed) return;
      bodyView.hidden = toggleIsolated(bodyView.hidden, bodiesOf(committed).map((b) => b.id), id);
      applyVisibility();
    },
    toggleGhost(id) {
      bodyView.ghost = toggleGhost(bodyView.ghost, id);
      if (bodyView.focus) bodyView.focus = { ...bodyView.focus, added: new Set([...bodyView.focus.added].filter((b) => bodyView.ghost.has(b))) };
      applyVisibility();
    },
    toggleFocus(id) {
      const committed = d.committed();
      if (!committed) return;
      const next = toggleFocus(bodyView.ghost, bodyView.focus, bodiesOf(committed).map((b) => b.id), id);
      bodyView.ghost = next.ghost;
      bodyView.focus = next.focus;
      applyVisibility();
    },
    duplicate(id) {
      runBodyRequest("duplicate_body", id);
    },
    remove(id) {
      runBodyRequest("delete_body", id);
    },
    removeMany(ids) {
      d.core
        .request<MeshData>("delete_body", { bodies: ids })
        .then((mesh) => d.setCommitted(mesh, false, []))
        .catch(fail);
    },
    setMaterial(id, material) {
      d.core
        .request<MeshData>("set_body_material", { body: id, material })
        .then((mesh) => d.setCommitted(mesh, false, d.selection()))
        .catch(fail);
    },
    rename(id, name) {
      d.core
        .request<MeshData>("rename_body", { body: id, name })
        .then((mesh) => d.setCommitted(mesh, false, d.selection()))
        .catch((e) => {
          fail(e);
          const committed = d.committed();
          if (committed) bodyList.setBodies(bodiesOf(committed), bodyView.hidden, bodyView.ghost, bodyView.focus?.body ?? null);
        });
    },
    select(ids) {
      d.select(ids.map((id) => ({ kind: "body" as const, id })));
    },
    hover(id) {
      d.hover(id === null ? null : { kind: "body", id });
    },
    edit(id) {
      d.editPrimitive(id);
    },
  }, d.count);
  bodyList.setBodies([], new Set()); // the list is always shown; before a model exists it says so
  return { bodyList, applyVisibility, setVisibility };
}
