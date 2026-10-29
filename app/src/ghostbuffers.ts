/** The ghost buffers of a push/pull subtract preview reply (see subtractghost.ts); pure, so the client and the tests can load it. */
export interface GhostBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** The ghost of a decoded reply, or null when it has none (absent, empty or malformed). */
export function ghostOf(header: Record<string, any>, buffers: Record<string, Float32Array | Uint32Array>): GhostBuffers | null {
  const info = header.ghost;
  const positions = buffers.ghostPositions as Float32Array | undefined;
  const normals = buffers.ghostNormals as Float32Array | undefined;
  const indices = buffers.ghostIndices as Uint32Array | undefined;
  if (!info || !positions || !normals || !indices || !(info.triangles > 0) || indices.length < 3) return null;
  return { positions, normals, indices };
}
