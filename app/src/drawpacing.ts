/** Decides whether the 3D view draws a frame: it draws while something is going on and rests when nothing is. */

/** How long the view keeps drawing after the last sign of activity. */
export const REST_AFTER_MS = 1000;

export interface DrawPacing {
  /** Something happened that can change the picture: draw the coming frames. */
  wake(): void;
  /** Asked once per frame with the time: whether this frame is drawn. */
  draws(now: number): boolean;
}

/**
 * The time to rest is counted from the first frame after a wake, not from the wake itself: a handler that works for
 * longer than the rest time (a large model arriving) still gets its frames once it is done.
 */
export function createDrawPacing(restAfterMs = REST_AFTER_MS): DrawPacing {
  let woken = true; // the first frames are drawn
  let until = 0;
  return {
    wake() {
      woken = true;
    },
    draws(now) {
      if (woken) {
        woken = false;
        until = now + restAfterMs;
      }
      return now < until;
    },
  };
}

/** What the user can do to the page; any of it may change the picture (a hover, a key, a panel button, a new window size). */
const ACTIVITY = ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "keydown", "keyup", "input", "change", "drop", "resize", "focus", "visibilitychange"];

/** Wake the pacing on every user action anywhere in the page. */
export function wakeOnActivity(pacing: DrawPacing, target: Pick<EventTarget, "addEventListener"> = window) {
  for (const type of ACTIVITY) target.addEventListener(type, () => pacing.wake(), { capture: true, passive: true });
}
