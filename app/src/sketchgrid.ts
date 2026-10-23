/** The sketch grid: a shader-drawn grid on the sketch plane. Moved out of sketch.ts. */
import * as THREE from "three";
import type { SketchOptions } from "./sketch";
import type * as M from "./sketchmodel";

/** Fade start and end as a distance from the middle of the view (0 = the middle, 1 = the middle of each side), per setting. */
const FADE: Record<SketchOptions["fade"], [number, number]> = { off: [10, 11], subtle: [0.75, 1.5], strong: [0.3, 1.15] };

export function disposeGrid(grid: THREE.Group) {
  for (const child of grid.children) {
    const lines = child as THREE.LineSegments;
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
  }
}

/**
 * The grid on the sketch plane, drawn by a shader so it has no edge: bold lines every `major` units and, if asked,
 * lighter ones between them. Lines too close together on screen fade out (zoomed far out), and the whole grid
 * fades toward the edges of the view, measured from the middle of the view so panning never moves the fade.
 */
export function buildGridGroup(options: Pick<SketchOptions, "major" | "minor" | "fade">, color: number, f: ReturnType<typeof M.frame>): THREE.Group {
  const { major, minor, fade } = options;
  const [fadeFrom, fadeTo] = FADE[fade];
  const uniforms: Record<string, THREE.IUniform> = {
    uMajor: { value: major },
    uMinor: { value: minor > 0 && minor < major ? minor : 0 },
    uColor: { value: new THREE.Color(color) },
    uFade: { value: new THREE.Vector2(fadeFrom, fadeTo) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uUnproject: { value: new THREE.Matrix4() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    // A screen-filling quad: each pixel finds where its own view ray meets the sketch plane. Drawing a huge plane
    // instead left the lines wobbling while the camera moved, because the clipped corners lost precision.
    vertexShader: `
      varying vec2 vNdc;
      void main() {
        vNdc = position.xy;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform float uMajor;
      uniform float uMinor;
      uniform vec3 uColor;
      uniform vec2 uFade;
      uniform vec2 uResolution;
      uniform mat4 uUnproject;
      varying vec2 vNdc;
      vec2 vPlane;
      // Line strength (0..1) for lines every \`spacing\` units, about one pixel wide, faded out once the lines are
      // closer than a few pixels.
      float lines(float spacing) {
        vec2 coord = vPlane / spacing;
        vec2 width = fwidth(coord);
        vec2 g = abs(fract(coord - 0.5) - 0.5) / max(width, vec2(1e-6));
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float density = max(width.x, width.y); // cell fraction per pixel: above 0.25 the lines are under 4 px apart
        return line * (1.0 - smoothstep(0.12, 0.3, density));
      }
      void main() {
        vec4 near = uUnproject * vec4(vNdc, -1.0, 1.0);
        vec4 far = uUnproject * vec4(vNdc, 1.0, 1.0);
        vec3 a = near.xyz / near.w;
        vec3 b = far.xyz / far.w;
        if (abs(a.z - b.z) < 1e-9) discard; // the ray runs along the plane
        float t = a.z / (a.z - b.z);
        if (t < 0.0) discard; // the plane is behind the camera along this ray: without this a mirror grid sweeps through the real one at grazing angles
        vPlane = (a + (b - a) * t).xy;
        float strength = lines(uMajor) * 0.6;
        if (uMinor > 0.0) strength = max(strength, lines(uMinor) * 0.25);
        vec2 centred = (gl_FragCoord.xy / uResolution - 0.5) * 2.0;
        float away = length(centred * vec2(uResolution.x / uResolution.y, 1.0)) / 1.0;
        float fadeOut = 1.0 - smoothstep(uFade.x, uFade.y, away);
        float alpha = strength * fadeOut;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment> // the colour is given as on screen, as the old line grid was; without this it came out far darker
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  // Set just before the grid is drawn, from the camera that draws it, so the lines never lag a frame behind a moving camera.
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const toClip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(grid.matrixWorld);
    (material.uniforms.uUnproject.value as THREE.Matrix4).copy(toClip).invert();
    (material.uniforms.uResolution.value as THREE.Vector2).copy(renderer.getDrawingBufferSize(new THREE.Vector2()));
  };
  const grid = new THREE.Group();
  grid.add(mesh);
  grid.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.n)));
  grid.position.set(...f.origin);
  grid.renderOrder = 1;
  return grid;
}
