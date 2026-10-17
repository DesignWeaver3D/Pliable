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

Replies to `tool_preview`/`tool_commit` also carry `preview` (bool) and `selection` (`{"faces": [ids], "edges": [ids], "vertices": [ids]}`): the faces in the **new** mesh that the old selection maps to, so the UI can keep selecting them. Face and edge ids belong to one mesh; they are not stable across operations except through this mapping.

## Requests

| type | params | reply |
|---|---|---|
| `hello` | | `{version}` |
| `open_demo` | `name` (`block`, `bracket`, `perforated_plate`) | mesh |
| `import_step` | `name`, `data` (base64 STEP) | mesh |
| `export_step` | | `{name, data}` (base64) |
| `list_tools` | | `{tools: [ToolDescription]}` |
| `sketch_plane` | `face` id, or `plane` "XY"/"XZ"/"YZ" | `{plane: {origin, normal, xdir}}` for sketching on a flat face or a world plane |
| `sketch_solve` | `sketch`, optional `drag` {point, u, v} | `{status: "ok"/"failed", dof, failed: [constraint ids], points: [{id, u, v}], radii}`; sketch format and constraint types in `core/src/pliable/sketch.py` |
| `sketch_extrude` | `sketch`, `distance`, `mode` "join"/"cut", `commit` | a mesh reply (preview unless `commit`): the sketch's profile extruded along the plane normal and joined or cut |
| `combine_step` | `data` (base64 STEP), `mode` "union"/"cut"/"intersect", optional `dx`, `dy`, `dz` | a mesh reply: the model combined with the imported solid (committed) |
| `model_info` | | the measure reply format with one `model` item: validity, counts, open edges, volume, size |
| `related` | `face` id | `{rules: [{id, label, faces: [ids]}]}`: coplanar, equal-radius and coaxial faces (relationship chips) |
| `available_tools` | `selection` | `{tools: [id]}` tools usable with that selection |
| `measure` | `selection` | `{items: [Measured], summary: [Row]}` measurements of the selection (one kind of item at a time) |
| `tool_preview` | `tool`, `selection`, `params` | mesh (document unchanged) |
| `tool_commit` | `tool`, `selection`, `params` | mesh (document updated, undoable) |
| `undo`, `redo` | | mesh |

`selection` is `{"faces": [ids], "edges": [ids], "vertices": [ids]}`; omitted lists are empty.

Previews may use a faster, slightly less exact algorithm than commits. The frontend keeps one preview in flight and always sends the newest parameters next.

## Measurements

`measure` returns one `Measured` per selected item plus a `summary` for several items. A `Row` is `{label, value, unit}`; `value` is a number or an `[x, y, z]` array, lengths are in model units (`unit` is empty) and angles in degrees (`unit` is `"°"`).

```json
{"kind": "face", "id": 9, "title": "Cylinder", "anchor": [x, y, z],
 "rows": [{"label": "Radius", "value": 7, "unit": ""}, {"label": "Diameter", "value": 14, "unit": ""}, ...]}
```

`title` is the geometry type (Line, Circle, Arc, Ellipse, Plane, Cylinder, Cone, Sphere, Torus, Fillet, Vertex); rows depend on it (`core/src/pliable/measure.py`). `anchor` is a point on the item for placing a label. The summary has the count, totals (length or area) and, for exactly two items, their distance and the angle between them when both define a direction (lines, planes). Unknown ids give an error reply, as does a mix of kinds.

## Tool description

```json
{
  "id": "push_pull",
  "label": "Push/Pull",
  "accepts": {"faces": [1, 1], "edges": [0, 0], "vertices": [0, 0]},
  "params": [{"name": "distance", "kind": "length", "default": 0.0, "drag": true}]
}
```

- `accepts`: `[min, max]` selected faces, edges and vertices (`max` null = unbounded).
- `params[].kind`: `length` (model units), `angle` (degrees) or `number`. `drag: true` marks the parameter the viewport drag controls.
- A tool can also refuse a selection the counts allow (push/pull rejects curved faces); `available_tools` reports that.

## Adding a tool

See `core/src/pliable/tools.py` (the module docstring and `PushPull`). Declare `id`, `label`, `accepts`, `params`, optionally `applies`, and implement `run(topology, selection, values, preview)` returning an `OpResult` (new shape plus the faces the selection should follow). Decorate with `@register`; the protocol, validation and applicability checks need nothing else.
