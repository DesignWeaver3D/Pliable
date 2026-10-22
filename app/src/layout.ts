/**
 * Where tools appear in the "All tools" list: groups in display order, each with tool ids in order.
 * This is the single place to rearrange the tool GUI. Tools missing here are listed under "Other"
 * automatically, so a new tool shows up without touching this file.
 */
export const TOOL_GROUPS: { title: string; tools: string[] }[] = [
  { title: "Edit faces", tools: ["push_pull", "delete_face", "align_face", "draft", "round_face"] },
  { title: "Edges", tools: ["fillet_chamfer", "resize_fillet", "resize_chamfer", "variable_fillet", "fillet_per_edge", "chamfer_two_distances", "chamfer_distance_angle", "remove_round"] },
  { title: "Holes", tools: ["add_hole", "add_counterbore", "add_countersink", "add_slot", "add_boss", "edit_hole", "convert_to_countersink", "convert_to_counterbore", "resize_hole", "move_hole", "center_between", "align_holes", "distribute_holes", "pattern_hole", "pattern_hole_circular", "fill_hole"] },
  { title: "Solids", tools: ["add_box", "add_cylinder", "add_sphere", "add_cone", "add_torus", "linear_array", "circular_array", "path_array", "revolve_face", "loft_faces", "sweep_face", "body_boolean", "shell", "mirror", "unify", "patch_fill", "bridge", "offset_body", "cut_plane"] },
  { title: "Move, rotate, scale", tools: ["move_body", "scale_body"] },
];

/** World planes offered for starting a sketch (besides the selected flat face). */
export const SKETCH_PLANES = ["XY", "XZ", "YZ"];

/** The global axes that become the sketch's X (along the bottom of the button) and Y (up its left edge) on each plane;
 * the buttons draw them in the axis colours (the --axis-x, --axis-y and --axis-z tokens in index.html). */
export const SKETCH_PLANE_AXES: Record<string, { bottom: "x" | "y" | "z"; left: "x" | "y" | "z" }> = {
  XY: { bottom: "x", left: "y" },
  XZ: { bottom: "x", left: "z" },
  YZ: { bottom: "y", left: "z" },
};
