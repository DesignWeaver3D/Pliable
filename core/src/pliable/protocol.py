"""Wire format for messages between the Python core and the frontend.

Small messages are JSON text frames. Messages that carry mesh data are
binary frames laid out as:

    uint32 (little-endian)  header length in bytes
    header                  UTF-8 JSON, padded with spaces to a multiple of 4
    buffers                 raw typed-array data, each 4-byte aligned

The header's "buffers" list gives each buffer's name, dtype, byte offset
(relative to the start of the buffer section), and element count.
"""

import json
import struct

import numpy as np

from .tessellate import Mesh

DTYPES = {np.dtype(np.float32): "f32", np.dtype(np.uint32): "u32"}


def encode_binary(header: dict, buffers: dict[str, np.ndarray]) -> bytes:
    layout = []
    chunks = []
    offset = 0
    for name, array in buffers.items():
        data = np.ascontiguousarray(array).tobytes()
        layout.append({"name": name, "dtype": DTYPES[array.dtype], "offset": offset, "length": array.size})
        chunks.append(data)
        offset += len(data)
        padding = -len(data) % 4
        if padding:
            chunks.append(b"\0" * padding)
            offset += padding
    header_bytes = json.dumps({**header, "buffers": layout}).encode()
    header_bytes += b" " * (-len(header_bytes) % 4)
    return struct.pack("<I", len(header_bytes)) + header_bytes + b"".join(chunks)


def decode_binary(frame: bytes) -> tuple[dict, dict[str, np.ndarray]]:
    (header_length,) = struct.unpack_from("<I", frame)
    header = json.loads(frame[4 : 4 + header_length])
    base = 4 + header_length
    numpy_dtypes = {v: k for k, v in DTYPES.items()}
    buffers = {
        b["name"]: np.frombuffer(frame, dtype=numpy_dtypes[b["dtype"]], count=b["length"], offset=base + b["offset"])
        for b in header["buffers"]
    }
    return header, buffers


def encode_mesh(header: dict, mesh: Mesh) -> bytes:
    return encode_binary(
        {**header, "faces": mesh.faces, "edges": mesh.edges, "vertices": mesh.vertices, "centres": mesh.centres, "bodies": mesh.bodies, "bounds": mesh.bounds},
        {
            "positions": mesh.positions,
            "normals": mesh.normals,
            "indices": mesh.indices,
            "edgePositions": mesh.edge_positions,
        },
    )
