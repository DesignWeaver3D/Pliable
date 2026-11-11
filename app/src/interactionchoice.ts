/** The shared two-state control for the body interaction setting, shown on the Push/Pull card, the Hole Editor card and the generic tool form of every tool whose
 *  info has an `interaction` default. State and rules are in interactionlogic.ts. */
import { INTERACT_LABELS, INTERACT_TITLE, interaction, type Interact } from "./interactionlogic.ts";

export class InteractionChoice {
  readonly el = document.createElement("div");
  private readonly buttons = new Map<Interact, HTMLButtonElement>();
  private unsubscribe: (() => void) | null = null;
  private toolDefault: Interact | null = null;
  private disabled = false;

  /** `onChange` re-requests the preview after the user picks the other value. */
  constructor(private readonly onChange: () => void) {
    this.el.className = "row";
    this.el.title = INTERACT_TITLE;
    this.el.style.cssText = "display:flex;gap:4px";
    for (const value of ["this", "others"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = INTERACT_LABELS[value];
      button.title = INTERACT_TITLE;
      button.style.cssText = "flex:1;text-align:center";
      button.addEventListener("click", () => {
        if (this.disabled || interaction.effective(this.toolDefault) === value) return;
        interaction.choose(value);
        this.onChange();
      });
      this.buttons.set(value, button);
      this.el.append(button);
    }
    this.unsubscribe = interaction.subscribe(() => {
      if (!this.el.isConnected && this.unsubscribe) return void (this.unsubscribe(), (this.unsubscribe = null)); // the form was replaced
      this.sync();
    });
    this.el.hidden = true;
  }

  /** The tool the control belongs to (its `interaction` default; null or undefined: the tool has no setting). */
  setTool(toolDefault: Interact | null | undefined) {
    this.toolDefault = toolDefault ?? null;
    this.sync();
  }

  /** Greyed out while the tool ignores the setting (Push/Pull in New body mode). */
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    this.sync();
  }

  private sync() {
    this.el.hidden = !interaction.visible(this.toolDefault);
    const value = interaction.effective(this.toolDefault);
    for (const [id, button] of this.buttons) {
      button.classList.toggle("active", value === id);
      button.disabled = this.disabled;
    }
  }
}
