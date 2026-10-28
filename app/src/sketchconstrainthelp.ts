/** What each constraint button does and what it needs selected, for its tooltip and for the warning when it does not fit. */
export const CONSTRAINT_HELP: Record<string, { what: string; needs: string }> = {
  Dimension: { what: "puts the fitting dimension on the selection (a menu offers the choices when several fit)", needs: "a line, circle, arc or ellipse; two points; or two curves" },
  "Horizontal distance": { what: "sets the left-right distance between two points", needs: "two points, or a line" },
  "Vertical distance": { what: "sets the up-down distance between two points", needs: "two points, or a line" },
  "Horizontal / vertical": { what: "makes each line horizontal or vertical, whichever it is nearer", needs: "one or more lines" },
  Horizontal: { what: "makes a line, or the line between two points, horizontal", needs: "a line, or two points" },
  Vertical: { what: "makes a line, or the line between two points, vertical", needs: "a line, or two points" },
  Coincident: { what: "joins points, or puts a point on a curve", needs: "two or more points, or points and a curve" },
  Fixed: { what: "pins a point where it is: it cannot be dragged or moved by other constraints", needs: "one point" },
  Parallel: { what: "makes two lines parallel", needs: "two lines" },
  Perpendicular: { what: "makes two lines meet at a right angle", needs: "two lines" },
  Equal: { what: "makes two lines the same length, or two circles or arcs the same radius", needs: "two lines, or two circles or arcs" },
  Symmetric: { what: "mirrors two points about a line, or about a point", needs: "two points and a line or point to mirror about" },
  "Tangent / collinear": { what: "makes a curve touch another smoothly, or puts lines on one straight line", needs: "a circle or arc with a line, circle or arc; or two lines" },
  "Point on": { what: "keeps a point on a curve", needs: "one point and one curve" },
  Midpoint: { what: "keeps a point at the middle of a line", needs: "one point and one line" },
  Lock: { what: "freezes a curve where it is: its points cannot move and a circle keeps its size", needs: "one curve" },
  "Length / distance": { what: "sets the length of a line, or the distance between two points", needs: "a line, or two points" },
  "Point to line distance": { what: "sets the distance from a point to a line", needs: "one point and one line" },
  "Short radius": { what: "sets an ellipse's short radius", needs: "one ellipse" },
  Radius: { what: "sets the radius of a circle or arc", needs: "one circle or arc" },
  Diameter: { what: "sets the diameter of a circle or arc", needs: "one circle or arc" },
  Angle: { what: "sets the angle between two lines", needs: "two lines" },
  "Angle to horizontal axis": { what: "sets the angle of a line from the horizontal axis", needs: "one line" },
};

/** The tooltip text: the name, what it does, and what to select. */
export const constraintTip = (label: string): string => {
  const h = CONSTRAINT_HELP[label];
  return h ? `${label}: ${h.what}\nNeeds: ${h.needs}` : label;
};
