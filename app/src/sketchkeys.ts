/** Sketch-only keys that apply a constraint to the selection, like the D key of the smart dimension. They exist only while a sketch is
 *  being edited and can be redefined like every key. P (Parallel) and V (Vertical) are left unassigned: those keys already switch the
 *  projection and look at a face while sketching, so giving them away is the owner's decision. */
export interface SketchConstraintKey {
  id: string;
  /** The constraint button this key presses (its label in sketchconstraints.ts). */
  constraint: string;
  defaults: string[];
}

export const SKETCH_CONSTRAINT_KEYS: SketchConstraintKey[] = [
  { id: "sketch.coincident", constraint: "Coincident", defaults: ["C"] },
  { id: "sketch.equal", constraint: "Equal", defaults: ["E"] },
  { id: "sketch.symmetric", constraint: "Symmetric", defaults: ["S"] },
  { id: "sketch.horizontal", constraint: "Horizontal", defaults: ["H"] },
  { id: "sketch.tangent", constraint: "Tangent / collinear", defaults: ["T"] },
  { id: "sketch.perpendicular", constraint: "Perpendicular", defaults: ["L"] },
  { id: "sketch.radius", constraint: "Radius", defaults: ["R"] },
  { id: "sketch.parallel", constraint: "Parallel", defaults: [] },
  { id: "sketch.vertical", constraint: "Vertical", defaults: [] },
];
