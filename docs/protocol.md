# Core protocol

The Python core (`core/src/pliable/server.py`) talks to the frontend over one WebSocket (`ws://127.0.0.1:8765`). Each connection has its own session with one open document.

## Framing

- Requests are JSON text frames: `{"id": <int>, "type": <string>, ...params}`.
- Every request gets exactly one reply carrying the same `id`:
  - JSON reply: `{"id", "ok": true, "serverMs", ...fields}`.
  - Error: `{"id", "ok": false, "error": "<message>", "serverMs"}`.
  - Mesh reply: a JSON frame `{"id", "ok": true, "binary": true, "serverMs"}` immediately followed by one binary frame.
- Binary frame layout (see `protocol.py`): `uint32 LE header length`, UTF-8 JSON header padded to 4 bytes, then raw typed-array buffers (4-byte aligned) described by the header's `buffers` list (`name`, `dtype` `f32`|`u32`, `offset`, `length`).

## Mesh header

Fields: `kind: "mesh"`, `faces` (`id`, `start`, `count` into `indices`, `normal` for planar faces, `centroid`), `edges` (`id`, `start`, `count` into `edgePositions`, `normal`: unit vector pointing away from the material, the bisector of the adjacent faces' outward normals, or null), `vertices` (`id`, `position`), `bounds` `[xmin,ymin,zmin,xmax,ymax,zmax]`, `timings` (`opMs`, `meshMs`, `importMs`), `canUndo`, `canRedo`, `name` (on open). Buffers: `positions`, `normals` (f32 xyz), `indices` (u32), `edgePositions` (f32 xyz, consecutive pairs are segments).

`bodies`: one entry per solid, `{id, name, solid, bounds}`, in creation order of the solids' list. A body id is stable (it survives fillets, push/pull, moves, undo and redo; a split keeps it on the larger part, a union keeps the first body's id and consumes the second); a name is auto-made from the tool that created it ("Box 1", "Cylinder 2", numbered per kind) or taken from the STEP part name on import. Faces, edges and vertices carry `body` (the id of the body that owns them, null for loose faces) next to `solid` (the solid's index). Hidden state is frontend only. A selection may also carry `bodies` (body ids, not indices): move, rotate, scale and offset body then act on those bodies directly, rotate and scale pivoting about each body's bounding-box centre; every other tool refuses a body selection. Renaming a body is an undoable step.

Replies to `tool_preview`/`tool_commit` also carry `preview` (bool) and `selection` (`{"faces": [ids], "edges": [ids], "vertices": [ids], "bodies": [ids]}`): the faces in the **new** mesh that the old selection maps to, so the UI can keep selecting them. Face and edge ids belong to one mesh; they are not stable across operations except through this mapping.

## Requests

| type | params | reply |
|---|---|---|
| `hello` | | `{version}`, plus `restore: {name, steps, clean}` when an autosave from a session that was killed (not closed cleanly) exists |
| `restore_session` | | mesh: the autosaved model with its undo steps (saved as BREP in the user data folder, `PLIABLE_DATA` overrides; capped at 50 states) |
| `open_demo` | `name` (`block`, `bracket`, `perforated_plate`) | mesh |
| `import_step` | `name`, `data` (base64 STEP) | mesh |
| `export_step` | | `{name, data}` (base64) |
| `list_tools` | | `{tools: [ToolDescription]}` |
| `sketch_plane` | `face` id, or `plane` "XY"/"XZ"/"YZ" with an optional `offset` along its normal | `{plane: {origin, normal, xdir}}` for sketching on a flat face or a world plane; for a face also `reference`: the face outline as fixed construction `points`/`entities` (points flagged `fixed`) |
| `sketch_solve` | `sketch`, optional `drag` {point, u, v} | `{status: "ok"/"failed", dof, failed: [constraint ids], points: [{id, u, v}], radii}`; sketch format and constraint types in `core/src/pliable/sketch.py` |
| `sketch_extrude` | `sketch`, `distance` (an angle in degrees when `axis` is given), `mode` "join"/"cut", optional `symmetric` (extrude both ways about the plane), optional `axis` (id of a sketch line: revolve about it instead), `commit` | a mesh reply (preview unless `commit`): the sketch's profile extruded along the plane normal and joined or cut |
| `sketch_regions` | `sketch` | a committed mesh reply: every closed zone of the sketch becomes a face; zones lying on a flat model face are imprinted on it, the others are added as loose faces that push/pull extrudes into solids |
| `sketch_offset` | `sketch`, `entities` (ids), `distance` | `{points, entities}`: parallel copies of the chosen lines, arcs and circles with fresh ids and no constraints (positive grows a closed outline) |
| `sketch_project` | `plane` | `{points, entities}`: every model edge flattened onto the plane as fixed reference geometry (lines square to the plane and tilted circles are left out) |
| `rename_body` | `body` (id), `name` | a mesh reply with the new name (an undo step); an empty name or unknown id is an error |
| `combine_step` | `data` (base64 STEP), `mode` "union"/"cut"/"intersect", optional `dx`, `dy`, `dz` | a mesh reply: the model combined with the imported solid (committed) |
| `model_info` | | the measure reply format with one `model` item: validity, counts, open edges, volume, size |
| `related` | `face` id | `{rules: [{id, label, faces: [ids]}]}`: coplanar, equal-radius and coaxial faces (relationship chips) |
| `edge_chain` | `edge` id | `{edges: [ids]}`: the edge and every edge joined to it through smooth vertices (a rim or outline) |
| `edge_selection` | `mode`: `face_edges` or `face_loops` with `face`; `shared_loop` with `first` and `second` edge ids | `{edges}` (all edges of the face; the loop of a face both edges border) or `{loops}` (one id list per boundary loop, outer first) |
| `available_tools` | `selection` | `{tools: [id]}` tools usable with that selection |
| `measure` | `selection` | `{items: [Measured], summary: [Row]}` measurements of the selection (one kind of item at a time) |
| `tool_handles` | `tool`, `selection`, `params` | `{handles: [Handle], startsFrom}`: the on-screen manipulators for those values (see Handles); empty for a tool without any |
| `tool_preview` | `tool`, `selection`, `params` | mesh (document unchanged), with `handles` for the previewed values |
| `tool_commit` | `tool`, `selection`, `params` | mesh (document updated, undoable), `handles` empty |
| `undo`, `redo` | | mesh |
| `diagnostics` | | `{report}`: versions, last tool, import warnings, log lines and `usage` (per tool: start/commit/cancel/error counts and start surfaces) |
| `usage_event` | `tool`, `event` (start, commit, cancel, error), `surface` (strip, search, drawer, keys, drag, other) | `{}`; counted in memory for the diagnostics report |
| `usage_clear` | | `{}`; resets the usage counts |
| `notice_get` | | `{acknowledged, epoch}`: whether this user has acknowledged the alpha notice (per user, in the shared data folder) |
| `notice_ack` | | `{acknowledged: true, epoch}`; written atomically |

`selection` is `{"faces": [ids], "edges": [ids], "vertices": [ids]}`; omitted lists are empty.

Previews may use a faster, slightly less exact algorithm than commits. The frontend keeps one preview in flight and always sends the newest parameters next.

## Measurements

`measure` returns one `Measured` per selected item plus a `summary` for several items. A `Row` is `{label, value, unit}`; `value` is a number or an `[x, y, z]` array, lengths are in model units (`unit` is empty) and angles in degrees (`unit` is `"°"`).

```json
{"kind": "face", "id": 9, "title": "Cylinder", "anchor": [x, y, z],
 "rows": [{"label": "Radius", "value": 7, "unit": ""}, {"label": "Diameter", "value": 14, "unit": ""}, ...]}
```

`title` is the geometry type (Line, Circle, Arc, Ellipse, Plane, Cylinder, Cone, Sphere, Torus, Fillet, Vertex); rows depend on it (`core/src/pliable/measure.py`). `anchor` is a point on the item for placing a label. The summary has the count, totals (length or area) and, for exactly two items, their distance and the angle between them when both define a direction (lines, planes). Unknown ids give an error reply, as does a mix of kinds.

A face or circular edge that belongs to a round hole (plain, counterbore, countersink, blind or through) also carries `hole`: `{kind, faces, rimEdges, entry, end, centre, direction, diameter, depth, through, bottom, tipAngle, stages, passLength}`. `entry` is on the axis at the opening, `direction` runs into the material, `depth` is to the end of the main bore, `stages` lists counterbores (`diameter`, `depth`) and countersinks (`diameter`, `angle`, `depth`), `passLength` is the depth that means "through". Non-round cuts (rectangles, slots, partial rounds) have none; they are pockets. The description comes from `core/src/pliable/holes.py`.

## Tool description

```json
{
  "id": "push_pull",
  "label": "Push/Pull",
  "description": "Moves flat faces in or out along their normal...",
  "accepts": {"faces": [1, 1], "edges": [0, 0], "vertices": [0, 0]},
  "params": [{"name": "distance", "kind": "length", "default": 0.0, "drag": true}],
  "startsFrom": "selection",
  "hasHandles": false
}
```

- `description`: one or two plain sentences on what the tool does and what to select; the interface shows it as the tool's tooltip. Every registered tool must have one (`tests/test_tool_descriptions.py`).
- `accepts`: `[min, max]` selected faces, edges and vertices (`max` null = unbounded).
- `params[].kind`: `length` (model units), `angle` (degrees) or `number`. `drag: true` marks the parameter the viewport drag controls.
- A tool can also refuse a selection the counts allow (push/pull rejects curved faces); `available_tools` reports that.

## Handles

A tool can declare on-screen manipulators (gizmos), one per parameter, by overriding `Tool.handles(topology, selection, values)` to return `Handle` objects (`core/src/pliable/tools.py`). Typed entry stays available for every parameter. Tool descriptions carry `hasHandles` and `startsFrom`: `"selection"` (select something, then the tool acts on it) or `"tool"` (the tool is chosen first and places something new, like a primitive, so its handles show from the start without a selection).

```json
{"param": "height", "label": "Height", "anchor": [x, y, z], "direction": [x, y, z],
 "scale": 1.0, "min": 0.001, "unit": "mm", "value": 10, "kind": "resize",
 "links": [{"param": "x", "scale": -1.0, "value": 0}]}
```

- The handle sits at `anchor` (a model point, where the parameter's current value puts it) and slides along the straight unit `direction`. Dragging it by t model units sets the parameter to `value + scale * t` (a diameter handle on a radius uses scale 2), never below `min` (null = unbounded). `unit` follows the value in the live label.
- `kind` is how the view draws it: `"arrow"` (a plain drag arrow, orange), `"move"` (an arrow in the origin-axis colour that starts at its anchor and points the positive way along its axis; it moves something), `"resize"` (a neutral square grip with an orange hover; it changes a size) or `"toggle"` (a click marker). Hovered and dragged handles grow slightly and show their name and value.
- `links` lists other parameters that change together with this one, each by `scale` per unit of travel. A grip on the low face of a box has direction -X, sets `width` with scale 1 and links `x` with scale -1, so dragging it outward grows the box that way and the high face stays fixed; the stored parameters stay size plus origin. The view applies linked values in the same form update. Primitives declare: box, a grip on each of the six faces; cylinder, four side grips for the diameter and a grip on each end for the height (the bottom one moves `z`); cone, both diameters from either side and the height from either end; sphere, six grips for the diameter (about the centre); torus, the ring diameter from both sides and the tube diameter from top and bottom.
- A rotation is declared the same way: the anchor sits on the ring, `direction` is the tangent there and `scale` is degrees per unit of travel (`unit` "°"); after each preview the handle is placed on the ring again at the new angle.
- The values the handles are computed for come from the request `params` (defaults fill the gaps), so every preview reply returns handles at the previewed values; the view moves a handle locally while dragging and snaps it to the reply.
- Handles never fail a request: an unusable selection or an error gives an empty list.

## Base points

`list_tools` also carries `moveVector` (three parameter names, for move and copy-step tools). The form then offers "Pick base point" and "Pick destination point" and fills the vector with destination minus base (base = origin by default). `tool_handles` replies carry `anchors`: `[{label, offset}]` for a tool with `placement` (the primitives), the snap points of the new shape (corners, edge midpoints, face centres, centre, axis end points) as offsets from the placement point. There is no base-point list: "Pick base point" offers these anchors (at placement point plus offset) together with the ordinary snap points, and the picked point, wherever it is, becomes the base; the placement point is then set to destination minus (base minus the placement point at pick time). With no base picked the base is the placement point.

## Adding a tool

See `core/src/pliable/tools.py` (the module docstring and `PushPull`). Declare `id`, `label`, `description`, `accepts`, `params`, optionally `applies`, and implement `run(topology, selection, values, preview)` returning an `OpResult` (new shape plus the faces the selection should follow). Decorate with `@register`; the protocol, validation and applicability checks need nothing else.
