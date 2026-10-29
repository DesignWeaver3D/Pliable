/** Connects the Push/Pull card to the view: the gizmo's tilts and direction, the drag that previews a typed distance, and when the card opens and closes.
 *  Moved out of main.ts; the card (pushpullcard.ts) and the state (pushpullstate.ts) know nothing of the view. */
import type { Sel, Viewport } from "./viewport";
import { PushPullCard } from "./pushpullcard.ts";
import { leavesFace, outOf } from "./pulldir.ts";

export interface PushPullWireDeps {
  viewport: Viewport;
  el: HTMLElement;
  selection(): Sel[];
  /** The tool the user armed in the toolbar or palette. */
  armedTool(): string | null;
}

export function createPushPullCard(d: PushPullWireDeps): PushPullCard {
  const { viewport } = d;
  const card = new PushPullCard(d.el, {
    state: viewport.pushPull,
    direction: () => viewport.pullDirection.dir ?? viewport.pullDirection.normal,
    tilts: () => viewport.pullGizmo.tilts(),
    setTilts: (red, green) => viewport.pullGizmo.setTilts(red, green),
    setDirection(direction) {
      const normal = viewport.pullDirection.normal;
      if (normal && !leavesFace(direction, normal)) return; // too close to the face's own plane: the core refuses it too
      viewport.pullDirection.set(normal ? outOf(direction, normal) : direction);
    },
    // A typed distance runs the same preview and commit as a drag of that length (itemdrag.ts), from the selection the card was opened on.
    previewDistance: (value) => viewport.onItemDrag(d.selection(), value, "move", d.el.getBoundingClientRect().left - 80, d.el.getBoundingClientRect().top + 40),
    applyDistance: (value) => viewport.onItemDrag(d.selection(), value, "end"),
    cancelDistance: () => viewport.onItemDrag(d.selection(), 0, "cancel"),
  });
  viewport.pullGizmo.onFrame = () => card.sync();
  // The selection changed (pressing a face selects it before its drag starts): a card opened by a drag closes; one opened by the armed Push/Pull button stays.
  viewport.pullDirection.onReset = () => {
    if (d.armedTool() === "push_pull") card.sync(true);
    else card.close();
  };
  return card;
}
