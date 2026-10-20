/**
 * Materials for model bodies. A material has a name, a density and the numbers the 3D view uses to draw
 * it. `render` feeds the viewport directly, so a new material only needs new numbers.
 * `density` (kg per cubic metre) is for a later mass calculation and is not used anywhere yet.
 */
export interface Material {
  id: string;
  name: string;
  /** Kilograms per cubic metre; not used yet (reserved for mass). */
  density: number;
  render: {
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    /** Strength of the studio reflections on the surface. */
    envMapIntensity: number;
  };
}

export const MATERIALS: Material[] = [
  {
    id: "plastic",
    name: "Plastic, semi-gloss",
    density: 1050, // as for ABS
    render: { roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.8 },
  },
];

export const DEFAULT_MATERIAL_ID = "plastic";

export function getMaterial(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

export function defaultMaterial(): Material {
  return getMaterial(DEFAULT_MATERIAL_ID)!;
}
