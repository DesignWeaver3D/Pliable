/** The docked side panel's width rules and what is remembered about it (pure, so tests can run it). */

export const DOCK_MIN_PX = 220;
export const DOCK_MAX_PX = 560;
export const DOCK_DEFAULT_PX = 262;
/** The panel never takes more than this share of the window, so the 3D view always keeps most of it. */
const DOCK_MAX_SHARE = 0.45;

export interface DockState {
  hidden: boolean;
  width: number;
}

/** A requested width limited to the minimum, the maximum and the share of the window. */
export function clampDockWidth(width: number, windowWidth: number): number {
  const most = Math.max(DOCK_MIN_PX, Math.min(DOCK_MAX_PX, Math.floor(windowWidth * DOCK_MAX_SHARE)));
  const w = Number.isFinite(width) ? width : DOCK_DEFAULT_PX;
  return Math.round(Math.min(most, Math.max(DOCK_MIN_PX, w)));
}

/** The remembered state from its saved text; anything unreadable gives the default (open, default width). */
export function parseDockState(raw: string | null): DockState {
  try {
    const o = JSON.parse(raw ?? "null");
    return { hidden: o?.hidden === true, width: typeof o?.width === "number" ? o.width : DOCK_DEFAULT_PX };
  } catch {
    return { hidden: false, width: DOCK_DEFAULT_PX };
  }
}
