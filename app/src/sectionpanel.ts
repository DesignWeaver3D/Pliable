/** The Section view card: the same ways to choose the plane as the Cut with plane form (Pick plane, the origin planes, datum
 *  planes, kept sketches, three points, edge and point, face offset and angle), a slider and a box for the distance
 *  along the plane's normal, a button for the side that is cut away, and the overlap readout. */
import { showNumber } from "./precision";
import { bodyColor } from "./bodycolors";
import { ORIGIN_PLANES, planeButtons } from "./planepicks";
import { planeBuildControls } from "./planebuild";
import type { SectionView } from "./sectionview";
import type { ToolPanelHost } from "./toolpanel";

export class SectionPanel {
  private readonly planeBox = document.createElement("div");
  private readonly slider = document.createElement("input");
  private readonly distance = document.createElement("input");
  private readonly readout = document.createElement("div");

  constructor(
    private readonly card: HTMLElement,
    private readonly view: SectionView,
    private readonly host: ToolPanelHost,
  ) {
    card.hidden = true;
    const head = document.createElement("div");
    head.className = "title";
    head.textContent = "Section view";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.title = "Close the section view and show the whole model";
    close.addEventListener("click", () => view.close());
    this.slider.type = "range";
    this.slider.title = "Slide the plane through the model";
    this.slider.addEventListener("input", () => view.setOffset(Number(this.slider.value)));
    this.distance.type = "text";
    this.distance.title = "Distance of the plane along its normal from where it was chosen (type a value and press Enter)";
    this.distance.setAttribute("aria-label", "Section distance");
    this.distance.addEventListener("change", () => {
      const value = parseFloat(this.distance.value);
      if (Number.isFinite(value)) view.setOffset(value);
      else this.refresh();
    });
    const flip = document.createElement("button");
    flip.textContent = "Flip side";
    flip.title = "Cut away the other side of the plane";
    flip.addEventListener("click", () => view.flip());
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = "Distance";
    row.append(label, this.distance);
    this.readout.className = "readout";
    this.readout.style.cssText = "margin-top:6px;font-size:12px";
    card.append(head, this.planeBox, this.slider, row, flip, this.readout, close);
    view.onChange = () => this.refresh();
  }

  /** Show or hide the card; the plane buttons are made again each time it opens (datum planes and kept sketches change). */
  setOpen(open: boolean) {
    this.card.hidden = !open;
    if (open) {
      this.buildPlaneButtons();
      this.refresh();
    }
  }

  private buildPlaneButtons() {
    const use = (origin: number[], normal: number[]) => this.view.setPlane(origin, normal);
    const pick = document.createElement("button");
    pick.textContent = "Pick plane";
    pick.title = "Click a flat face anywhere on the model to use its plane";
    pick.style.textAlign = "center";
    pick.addEventListener("click", async () => {
      const plane = await this.host.pickPlane?.();
      if (plane) use(plane.origin, plane.normal);
    });
    const origins = document.createElement("div");
    origins.style.cssText = "display:flex;gap:4px";
    planeButtons(this.host, use)
      .slice(0, ORIGIN_PLANES.length)
      .forEach((button, i) => {
        button.textContent = ORIGIN_PLANES[i].name;
        button.style.cssText = "text-align:center;margin-top:2px";
        origins.append(button);
      });
    const datums = (this.host.datumPlanes?.() ?? []).map((d) => {
      const button = document.createElement("button");
      button.textContent = `Datum: ${d.name}`;
      button.title = `Use the datum plane ${d.name}`;
      button.addEventListener("click", () => use(d.plane.origin, d.plane.normal));
      return button;
    });
    const rest = planeButtons(this.host, use).slice(ORIGIN_PLANES.length);
    this.planeBox.replaceChildren(pick, origins, ...datums, ...rest, ...planeBuildControls(this.host, () => this.view.active, use));
  }

  private refresh() {
    if (this.card.hidden) return;
    const [lo, hi] = this.view.range();
    this.slider.min = String(lo);
    this.slider.max = String(hi);
    this.slider.step = String(Math.max((hi - lo) / 500, 1e-6));
    this.slider.value = String(this.view.distance);
    this.slider.style.width = "100%";
    if (document.activeElement !== this.distance) this.distance.value = showNumber(this.view.distance, 2);
    const report = this.view.report;
    this.readout.replaceChildren();
    if (!report) return;
    const line = (text: string, colour?: string) => {
      const div = document.createElement("div");
      div.textContent = text;
      if (colour) div.style.color = colour;
      this.readout.append(div);
    };
    line(report.bodies === 0 ? "The plane does not cut any body." : `Cuts ${report.bodies} ${report.bodies === 1 ? "body" : "bodies"}.`);
    if (report.pairs.length) {
      line(`Bodies overlap here (${showNumber(report.overlapArea, 1)} mm²):`, "#ff2a2a");
      for (const [a, b] of report.pairs) line(`Body ${a} and body ${b}`, bodyColor(a));
    } else if (report.bodies > 1) line("No overlap between the cut faces.");
  }
}
