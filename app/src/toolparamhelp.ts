/** Form fields whose bare name is unclear: a fuller label and a tooltip. */
export const PARAM_HELP: Record<string, { label: string; title: string }> = {
  axis_edge: { label: "axis edge (id, set by Pick axis)", title: "The edge the copies turn about when the axis is Picked edge; use the Pick axis button rather than typing." },
  sink_by: { label: "countersink size by", title: "Enter the countersink's size as its own diameter, or as how far it reaches past the hole's wall (the offset); the field that is not chosen is ignored." },
  bore_by: { label: "counterbore size by", title: "Enter the counterbore's size as its own diameter, or as how far it reaches past the hole's wall (the offset); the field that is not chosen is ignored." },
  sink_offset: { label: "sink offset (mm)", title: "How far the countersink reaches past the hole's wall at the surface: its diameter is the hole's diameter plus twice this. Used when size by is Offset from hole." },
  bore_offset: { label: "bore offset (mm)", title: "How far the counterbore reaches past the hole's wall: its diameter is the hole's diameter plus twice this. Used when size by is Offset from hole." },
  nx: { label: "nx (direction x)", title: "The x part of the cutting plane's direction (its normal). Pick plane and the origin buttons fill it; typing a direction here uses it instead of an origin plane." },
  ny: { label: "ny (direction y)", title: "The y part of the cutting plane's direction (its normal)." },
  nz: { label: "nz (direction z)", title: "The z part of the cutting plane's direction (its normal)." },
  new_body: { label: "new body (1 = separate, 0 = join)", title: "1 keeps the new solid as its own body. 0 fuses it into the bodies it touches, which only shows when it overlaps or touches one." },
};

/** Labels for the parameters of one tool (by tool id), where the bare names are unclear: the linear array's columns, rows and planar shifts. */
export const TOOL_PARAM_HELP: Record<string, Record<string, { label: string; title: string }>> = {
  hole_features: {
    diameter: { label: "Hole diameter (mm)", title: "The hole's diameter. For an existing hole 0 leaves it as it is." },
    depth: { label: "Depth (mm)", title: "How deep the hole goes. 0 is through for a new hole and leaves the depth as it is for an existing one." },
    start: { label: "Start (mm)", title: "How far from the opening the bore starts (0 = at the opening)." },
    offset_u: { label: "Offset across (mm)", title: "Moves a new hole sideways from the center of the face." },
    offset_v: { label: "Offset along (mm)", title: "Moves a new hole up or down from the center of the face." },
    counterbore: { label: "Counterbore", title: "Widens the hole into a flat-bottomed step for a screw head." },
    countersink: { label: "Countersink", title: "Cuts a cone into the hole for a flat head screw." },
    thread: { label: "Thread", title: "Cuts a helical thread into the hole's bore." },
    bore_end: { label: "counterbore at", title: "The opening, or the far end of a through hole." },
    sink_end: { label: "countersink at", title: "The opening, or the far end of a through hole." },
    thread_size: { label: "Thread size", title: "A standard metric size sets the pitch; Custom uses the pitch box." },
    thread_pitch: { label: "Thread pitch (mm)", title: "The distance between turns, used when the thread size is Custom." },
    thread_hand: { label: "Thread hand", title: "Right-hand or left-hand thread." },
  },
  linear_array: {
    count: { label: "Columns", title: "How many copies in the column direction, the source included." },
    dx: { label: "Column spacing (mm)", title: "The distance between one column and the next (the X part of the column step)." },
    dz: { label: "Column Z-offset (mm)", title: "How far each column steps up (or down) from the one before." },
    rows: { label: "Rows", title: "How many rows, the source row included." },
    dy2: { label: "Row spacing (mm)", title: "The distance between one row and the next (the Y part of the row step)." },
    dz2: { label: "Row Z-offset (mm)", title: "How far each row steps up (or down) from the one before." },
    dy: { label: "Column Y planar shift (mm)", title: "How far each column is shifted sideways, along Y, from the one before." },
    dx2: { label: "Row X planar shift (mm)", title: "How far each row is shifted sideways, along X, from the one before." },
  },
};
