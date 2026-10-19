/**
 * Procedural icons: every tool icon is a base shape (what it works on) plus a small mark (what it does), drawn on a
 * 24 px grid in the current text colour, so the set reads as families and a new tool costs one line in TOOL_ICONS.
 * A tool with no entry gets a rounded square with its initials, so a missing icon never blocks a tool.
 * `icons.html` (dev server) is the contact sheet for reviewing all of them at 16 and 24 px.
 */

type Base = "face" | "edge" | "hole" | "body" | "none";

const BASES: Record<Base, string> = {
  face: '<path d="M3 15l5-7h13l-5 7z" fill="currentColor" fill-opacity=".22"/>',
  edge: '<path d="M4 17L18 6"/><circle cx="4" cy="17" r="1.7" fill="currentColor"/><circle cx="18" cy="6" r="1.7" fill="currentColor"/>',
  hole: '<path d="M3 15l5-7h13l-5 7z" fill="currentColor" fill-opacity=".22"/><ellipse cx="12" cy="11.5" rx="3.3" ry="1.7" fill="currentColor" fill-opacity=".6"/>',
  body: '<path d="M10 3l7 3.5v8.5l-7 3.5-7-3.5V6.5z"/><path d="M10 10l7-3.5M10 10L3 6.5M10 10v8.5"/>',
  none: "",
};

/** Marks sit in the lower right quarter (x 12-23, y 12-23) so they stay readable on top of any base. */
const MARKS: Record<string, string> = {
  up: '<path d="M18 22v-9M14.5 16.5L18 13l3.5 3.5"/>',
  plus: '<path d="M18 13v9M13.5 17.5h9"/>',
  minus: '<path d="M13.5 17.5h9"/>',
  move: '<path d="M17.5 12.5v10M12.5 17.5h10M15.5 14.5l2-2 2 2M15.5 20.5l2 2 2-2M14.5 15.5l-2 2 2 2M20.5 15.5l2 2-2 2"/>',
  rotate: '<path d="M13 18a4.8 4.8 0 1 0 2-4"/><path d="M15.7 11.8v3h-3"/>',
  scale: '<path d="M13 22v-6M13 22h6M13 22l9-9M17 13h5v5"/>',
  round: '<path d="M13 22v-4a6 6 0 0 1 6-6h3"/>',
  chamfer: '<path d="M13 22v-5l5-5h4"/>',
  chamfer2: '<path d="M13 22v-6l4-4h5"/><path d="M13 19h2M19 12v2"/>',
  array: '<circle cx="14" cy="19" r="1.4" fill="currentColor"/><circle cx="18.5" cy="19" r="1.4" fill="currentColor"/><circle cx="23" cy="19" r="1.4" fill="currentColor"/>',
  ring: '<circle cx="18" cy="13.5" r="1.4" fill="currentColor"/><circle cx="22" cy="17.5" r="1.4" fill="currentColor"/><circle cx="18" cy="21.5" r="1.4" fill="currentColor"/><circle cx="14" cy="17.5" r="1.4" fill="currentColor"/>',
  mirror: '<path d="M18 12v11" stroke-dasharray="2 1.6"/><path d="M15 15l-2.5 2.5L15 20M21 15l2.5 2.5L21 20"/>',
  boolean: '<circle cx="15.5" cy="17.5" r="4"/><circle cx="20" cy="17.5" r="4"/>',
  shell: '<rect x="13" y="13" width="9" height="9" rx="1"/><rect x="15.5" y="15.5" width="4" height="4"/>',
  draft: '<path d="M14 22l3-10M14 22h8"/>',
  align: '<path d="M13 12v10M13 15h9M13 20h6"/>',
  cross: '<path d="M14.5 14.5l6 6M20.5 14.5l-6 6"/>',
  cut: '<path d="M12 22l10-10" stroke-dasharray="2.4 1.6"/>',
  dot: '<circle cx="18" cy="18" r="3.5" fill="currentColor"/>',
  hollow: '<circle cx="18" cy="18" r="3.5"/>',
  step: '<path d="M14 13v5h8"/><path d="M14 18v4"/>',
  cone: '<path d="M13.5 13l4.5 6 4.5-6"/>',
  slot: '<rect x="13" y="15" width="10" height="6" rx="3"/>',
  loft: '<path d="M13 13h9M13 22h9M13 13v9M22 13v9" stroke-dasharray="2 1.4"/>',
  sweep: '<path d="M13 22c0-6 4-8 9-8"/><path d="M19.5 11.5L22 14l-2.5 2.5"/>',
  join: '<path d="M13 13h5v9h-5zM18 13h5v9h-5z"/>',
  offset: '<rect x="12.5" y="12.5" width="10" height="10"/><rect x="15" y="15" width="5" height="5"/>',
  bridge: '<path d="M12.5 21v-5M22.5 21v-5M12.5 16q5-5 10 0"/>',
  equal: '<path d="M13 16h10M13 20h10"/>',
  sphere: '<circle cx="18" cy="18" r="4.5"/><ellipse cx="18" cy="18" rx="4.5" ry="1.8"/>',
};

interface Spec {
  base: Base;
  mark?: keyof typeof MARKS;
  /** A whole drawing instead of base plus mark (primitives). */
  full?: string;
}

const spec = (base: Base, mark?: keyof typeof MARKS): Spec => ({ base, mark });

const SOLIDS = {
  add_box: '<path d="M11 3l8 4v10l-8 4-8-4V7z" fill="currentColor" fill-opacity=".16"/><path d="M11 11l8-4M11 11L3 7M11 11v10"/>',
  add_cylinder: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12a7 3 0 0 0 14 0V6" fill="currentColor" fill-opacity=".16"/>',
  add_sphere: '<circle cx="12" cy="12" r="8.5" fill="currentColor" fill-opacity=".16"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/>',
  add_cone: '<path d="M12 3l7.5 15a7.5 3 0 0 1-15 0z" fill="currentColor" fill-opacity=".16"/>',
  add_torus: '<ellipse cx="12" cy="12" rx="9" ry="6" fill="currentColor" fill-opacity=".16"/><ellipse cx="12" cy="12" rx="3.5" ry="1.8"/>',
};

export const TOOL_ICONS: Record<string, Spec> = {
  push_pull: spec("face", "up"),
  delete_face: spec("face", "cross"),
  align_face: spec("face", "align"),
  draft: spec("face", "draft"),
  round_face: spec("face", "round"),
  fillet_chamfer: spec("edge", "round"),
  resize_fillet: spec("edge", "scale"),
  resize_chamfer: spec("edge", "scale"),
  variable_fillet: spec("edge", "equal"),
  fillet_per_edge: spec("edge", "round"),
  chamfer_two_distances: spec("edge", "chamfer2"),
  chamfer_distance_angle: spec("edge", "chamfer"),
  remove_round: spec("edge", "cross"),
  add_hole: spec("hole", "minus"),
  add_counterbore: spec("hole", "step"),
  add_countersink: spec("hole", "cone"),
  add_slot: spec("hole", "slot"),
  add_boss: spec("face", "plus"),
  resize_hole: spec("hole", "scale"),
  move_hole: spec("hole", "move"),
  center_between: spec("hole", "equal"),
  align_holes: spec("hole", "align"),
  distribute_holes: spec("hole", "array"),
  pattern_hole: spec("hole", "array"),
  pattern_hole_circular: spec("hole", "ring"),
  fill_hole: spec("hole", "dot"),
  linear_array: spec("body", "array"),
  circular_array: spec("body", "ring"),
  path_array: spec("body", "sweep"),
  revolve_face: spec("face", "rotate"),
  loft_faces: spec("face", "loft"),
  sweep_face: spec("face", "sweep"),
  body_boolean: spec("none", "boolean"),
  shell: spec("body", "shell"),
  mirror: spec("body", "mirror"),
  unify: spec("face", "join"),
  patch_fill: spec("edge", "dot"),
  bridge: spec("edge", "bridge"),
  offset_body: spec("body", "offset"),
  cut_plane: spec("body", "cut"),
  split_plane: spec("body", "cut"),
  move_body: spec("body", "move"),
  rotate_body: spec("body", "rotate"),
  scale_body: spec("body", "scale"),
};

/** Interface icons for the top bar and other universal controls. */
export const UI_ICONS: Record<string, string> = {
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -4)"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12" transform="translate(0 -4)"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M10 4.5v15"/><path d="M5.5 4.5H10v15H5.5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z" fill="currentColor" fill-opacity=".35" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  more: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  axes: '<path d="M6 18V4M3.5 6.5L6 4l2.5 2.5"/><path d="M6 18h14M17.5 15.5L20 18l-2.5 2.5"/><path d="M6 18l-3.5 3.5M2.5 18.5v3h3"/>',
  iso: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  perspective: '<path d="M3 7l5-2h8l5 2v10l-5 2H8l-5-2z"/><path d="M8 5v14M16 5v14"/>',
  orthographic: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="9" y="9" width="6" height="6" fill="currentColor" fill-opacity=".25"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/>',
  import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  export: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/>',
  home: '<path d="M4 12l8-7 8 7M6.5 10.5V20h11v-9.5"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  toolsHammer: '<g stroke-width="2"><path d="M5 4h14v5.5h-5.5v10.5a1.5 1.5 0 0 1-3 0V9.5H5z" transform="rotate(-45 12 12)" fill="currentColor" fill-opacity=".22"/></g>',
  toolsBox: '<g stroke-width="2"><rect x="3" y="9" width="18" height="11" rx="2" fill="currentColor" fill-opacity=".22"/><path d="M9 9V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V9M3 13.5h18"/><rect x="10.5" y="12" width="3" height="3.5" rx=".7" fill="currentColor"/></g>',
  keys: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14h8"/>',
};

const wrap = (inner: string, size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** Inner SVG for a tool: its drawing, or the initials fallback. */
export function toolIconInner(id: string, label = id): string {
  if (id in SOLIDS) return SOLIDS[id as keyof typeof SOLIDS];
  const s = TOOL_ICONS[id];
  if (s) return BASES[s.base] + (s.mark ? MARKS[s.mark] : "");
  return initialsIcon(label);
}

/** Fallback for a tool without an icon: a rounded square carrying its first two letters. */
export function initialsIcon(label: string): string {
  const words = label.split(/[\s_/-]+/).filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2)).toUpperCase();
  return `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><text x="12" y="16" text-anchor="middle" font-size="9" font-family="system-ui, sans-serif" font-weight="600" stroke="none" fill="currentColor">${text}</text>`;
}

function element(inner: string, size: number, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = wrap(inner, size);
  return span;
}

/** Icon on the Tools handle (left edge). Placeholder: the owner picks the final one; change this one name to swap it. */
export const TOOLS_HANDLE_ICON = "sidebar";

export const toolIcon = (id: string, label = id, size = 16) => element(toolIconInner(id, label), size, "icon");
export const uiIcon = (name: string, size = 16) => element(UI_ICONS[name] ?? "", size, "icon");

/** Put an icon before a button's label. */
export function withIcon(button: HTMLElement, icon: HTMLElement): void {
  button.prepend(icon);
}

export const allToolIconIds = () => [...Object.keys(SOLIDS), ...Object.keys(TOOL_ICONS)];
export const allUiIconNames = () => Object.keys(UI_ICONS);
export const svgFor = (inner: string, size: number) => wrap(inner, size);
