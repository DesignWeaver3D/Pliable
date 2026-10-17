/**
 * Where tools appear in the "All tools" list: groups in display order, each with tool ids in order.
 * This is the single place to rearrange the tool GUI. Tools missing here are listed under "Other"
 * automatically, so a new tool shows up without touching this file.
 */
export const TOOL_GROUPS: { title: string; tools: string[] }[] = [
  { title: "Edit faces", tools: ["push_pull", "delete_face", "align_face", "draft"] },
  { title: "Edges", tools: ["fillet_chamfer", "resize_fillet", "remove_round"] },
  { title: "Holes", tools: ["add_hole", "add_counterbore", "add_countersink", "resize_hole", "move_hole", "align_holes", "distribute_holes", "pattern_hole", "fill_hole"] },
  { title: "Solids", tools: ["add_box", "add_cylinder", "add_sphere", "add_cone", "shell", "mirror"] },
  { title: "Transform body", tools: ["move_body", "rotate_body", "scale_body"] },
];

/** World planes offered for starting a sketch (besides the selected flat face). */
export const SKETCH_PLANES = ["XY", "XZ", "YZ"];
