/** Whether the model has work that leaving would lose, and the page title that says so. The desktop shell reads the title's mark before it quits. */

/** Put before the page title while there is unsaved work. The shell looks for exactly this (`UNSAVED_MARK` in the shell's main.rs). */
export const UNSAVED_MARK = "• ";

export interface SaveState {
  /** The model has undo steps. */
  canUndo: boolean;
  sketchOpen: boolean;
  /** The core's name for the model state on screen, and for the one last saved as a project (null: none yet). */
  state: string | null;
  saved: string | null;
}

/** Work is unsaved while a sketch is open, or while the model has edits and is not the state that was last saved as a project. */
export function hasUnsavedWork(s: SaveState): boolean {
  return s.sketchOpen || (s.canUndo && (s.state === null || s.state !== s.saved));
}

export function pageTitle(base: string, unsaved: boolean): string {
  return unsaved ? UNSAVED_MARK + base : base;
}
