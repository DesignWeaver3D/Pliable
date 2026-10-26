// A stand-in for the sketch mode used by the builder tests: SketchMode.pointFor and addConstraintRaw rules, undo and solving as counters.
export function context(auto = "shape") {
  return {
    s: { plane: { origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] }, points: [], entities: [], constraints: [] },
    chain: [],
    rectOptions: { corner: "none", size: 5 },
    undos: 0,
    solves: 0,
    messages: [],
    pushUndo() { this.undos++; },
    resolve() { this.solves++; return Promise.resolve(true); },
    pointFor(snap) {
      if (snap.id !== undefined) return snap.id;
      const id = this.s.points.length + this.s.entities.length + this.s.constraints.length + 1;
      this.s.points.push({ id, u: snap.u, v: snap.v });
      snap.id = id;
      return id;
    },
    addConstraintRaw(c, kind = "shape") {
      if (kind !== "always" && (auto === "none" || (auto === "snaps" && kind === "shape"))) return;
      this.s.constraints.push({ id: this.s.points.length + this.s.entities.length + this.s.constraints.length + 1, ...c, auto: true });
    },
    status(text, error) { this.messages.push({ text, error }); },
  };
}
