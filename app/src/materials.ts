/**
 * Materials for model bodies. A material has a name, a group, a density and the numbers the 3D view uses
 * to draw it. `render` feeds the viewport directly, so a new material only needs new numbers.
 * `density` (kg per cubic meter) gives a selected body its mass in the measurement card (the chosen material's density).
 * The Default material setting applies to every body without its own choice; a body can be given its own material
 * from the body list menu (stored with the body in the project). The 3D view draws every body with the default material's look.
 */
export type MaterialGroup = "Plastic" | "Resin" | "Metal";

export interface Material {
  id: string;
  name: string;
  group: MaterialGroup;
  /** Kilograms per cubic meter; the measurement card's mass for a body. */
  density: number;
  /** Where the density comes from and how much it varies. */
  note?: string;
  render: {
    /** Surface color as sRGB hex. For metals it is the metal's own color; plastics and resins are tinted per body (or use this color when body colors are off). */
    color: number;
    roughness: number;
    metalness: number;
    clearcoat: number;
    clearcoatRoughness: number;
    /** Strength of the studio reflections on the surface. */
    envMapIntensity: number;
  };
}

const BLUE = 0x9db4cc; // the steel-blue of the plain (uncolored) surface

const plastic = (id: string, name: string, density: number, note: string, roughness: number, clearcoat: number, clearcoatRoughness: number): Material => ({
  id,
  name,
  group: "Plastic",
  density,
  note,
  render: { color: BLUE, roughness, metalness: 0, clearcoat, clearcoatRoughness, envMapIntensity: 0.8 },
});

const resin = (id: string, name: string, density: number): Material => ({
  id,
  name,
  group: "Resin",
  density,
  note: "Typical value; photopolymer resins vary roughly 1050-1250 kg/m3 by product",
  render: { color: BLUE, roughness: 0.25, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.9 },
});

const metal = (id: string, name: string, density: number, note: string, color: number, roughness: number, envMapIntensity = 1): Material => ({
  id,
  name,
  group: "Metal",
  density,
  note,
  render: { color, roughness, metalness: 1, clearcoat: 0, clearcoatRoughness: 0, envMapIntensity },
});

export const MATERIALS: Material[] = [
  plastic("pla", "PLA", 1240, "Typical 1210-1430", 0.38, 0.4, 0.3),
  plastic("petg", "PETG", 1270, "Typical 1230-1290", 0.3, 0.5, 0.25),
  plastic("abs", "ABS", 1050, "Typical 1040-1070", 0.4, 0.35, 0.3),
  plastic("asa", "ASA", 1070, "Typical 1050-1100", 0.45, 0.25, 0.4),
  resin("resin-standard", "Resin, standard", 1100),
  resin("resin-tough", "Resin, tough", 1150),
  metal("steel", "Steel, mild", 7850, "Carbon steel, 7800-7870", 0xb9bcc2, 0.4),
  metal("stainless", "Steel, stainless", 8000, "Austenitic grades, 7900-8000", 0xc4c8cf, 0.3),
  metal("aluminium", "Aluminium 6061", 2700, "6061 alloy, 2700", 0xd4d6d9, 0.35),
  metal("copper", "Copper", 8960, "Pure copper, 8940-8960", 0xe0906f, 0.25),
  metal("gold", "Gold", 19320, "Pure gold, 19300", 0xe8b445, 0.15),
  metal("silver", "Silver", 10490, "Pure silver, 10490", 0xf0eee8, 0.12),
  metal("titanium", "Titanium Ti-6Al-4V", 4430, "Grade 5 alloy, 4420-4430", 0xa39d98, 0.48, 0.85),
  metal("cobalt", "Cobalt", 8900, "Pure cobalt, 8900", 0x8e9aa6, 0.3),
];

export const DEFAULT_MATERIAL_ID = "pla";

export function getMaterial(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

export function defaultMaterial(): Material {
  return getMaterial(DEFAULT_MATERIAL_ID)!;
}

/** The material for a setting value; unknown ids give the default. */
export function materialOrDefault(id: string): Material {
  return getMaterial(id) ?? defaultMaterial();
}

/** Metals show their own color; plastics and resins take the per-body tint. */
export function usesBodyColors(m: Material): boolean {
  return m.group !== "Metal";
}

/** Body id -> density for the bodies that have a material of their own (the rest follow the default material). */
export function ownDensities(bodies: { id: number; material?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bodies) {
    const m = b.material ? getMaterial(b.material) : undefined;
    if (m) out[String(b.id)] = m.density;
  }
  return out;
}
