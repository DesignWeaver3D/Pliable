/** Which points are hidden behind the model, answered from one depth picture of the view instead of one ray per point
 *  (a box select over a big model asked thousands of rays, each testing every triangle). */
import * as THREE from "three";

/** A point is hidden when the surface in front of it is nearer than this fraction of its own distance. */
const NEAR_FRACTION = 0.995;

/** The distance along the view axis that a depth buffer value (0 near, 1 far) stands for. */
export function viewDistance(depth: number, near: number, far: number, orthographic: boolean): number {
  if (orthographic) return near + depth * (far - near);
  const z = depth * 2 - 1;
  return (2 * near * far) / (far + near - z * (far - near));
}

/** The depth a packed RGBA byte quadruple holds (three.js's RGBADepthPacking). */
export function unpackDepth(r: number, g: number, b: number, a: number): number {
  return (255 / 256) * (r / 255 + g / 255 / 255 + b / 255 / 65025 + a / 255 / 16581375);
}

export class DepthProbe {
  private pixels = new Uint8Array(0);
  private width = 0;
  private height = 0;
  private camera: THREE.Camera | null = null;
  private orthographic = false;

  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Draw the mesh's solid triangles (material 0) as seen by the camera at the given size in CSS pixels. */
  capture(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number, clip: THREE.Plane[] | null) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.camera = camera;
    this.orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depthMaterial.clippingPlanes = clip;
    const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
    const copy = new THREE.Mesh(mesh.geometry, Array.isArray(mesh.material) ? [depthMaterial, hidden] : depthMaterial);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    copy.matrixWorld.copy(mesh.matrixWorld);
    const scene = new THREE.Scene();
    scene.add(copy);
    const target = new THREE.WebGLRenderTarget(this.width, this.height);
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousColour = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff, 1); // packed 1.0: nothing in front of the far plane
      renderer.clear();
      renderer.render(scene, camera);
      this.pixels = new Uint8Array(this.width * this.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, this.width, this.height, this.pixels);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousColour, previousAlpha);
      target.dispose();
      depthMaterial.dispose();
      hidden.dispose();
    }
  }

  /** Whether the solid model is in front of the world point (false before a capture). */
  hidden(p: THREE.Vector3): boolean {
    const camera = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
    if (!camera) return false;
    const n = p.clone().project(camera);
    if (n.z > 1 || n.z < -1) return false;
    const x = Math.floor(((n.x + 1) / 2) * this.width);
    const y = Math.floor(((n.y + 1) / 2) * this.height); // the target's rows run bottom to top
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const at = (y * this.width + x) * 4;
    const seen = viewDistance(unpackDepth(this.pixels[at], this.pixels[at + 1], this.pixels[at + 2], this.pixels[at + 3]), camera.near, camera.far, this.orthographic);
    const own = viewDistance((n.z + 1) / 2, camera.near, camera.far, this.orthographic);
    return seen < own * NEAR_FRACTION;
  }
}
