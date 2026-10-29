/** The mirrored arrow of push/pull: the face-normal arrow (the manipulator's push/pull handle) shows where a drag adds, this one starts at the same anchor and points
 *  the opposite way to show where a drag subtracts, in red. Flip swaps the roles (and so the colours). Pressing it grabs the arrow (see pushpullhit.ts and Manipulator.hit); the drag is the arrow's own, so dragging along the red arrow gives the opposite sign. */
import * as THREE from "three";
import { ARM_PX, HANDLE_OUTLINE, PUSH_PULL_ARM_RATIO, type Manipulator } from "./manipulator.ts";
import { arrowColors, SUBTRACT_COLOR } from "./pushpullcolors.ts";
import type { PushPullState } from "./pushpullstate.ts";

export class MirrorArrow {
  private readonly group = new THREE.Group();
  /** Set while a point is being picked (see Viewport.setGizmosHidden). */
  hidden = false;
  private readonly tip: THREE.Mesh;
  private readonly arm: THREE.Line;

  constructor(
    scene: THREE.Scene,
    private readonly pixelSizeAt: (p: THREE.Vector3) => number,
    private readonly manipulator: Manipulator,
    private readonly state: PushPullState,
  ) {
    const geometry = new THREE.ConeGeometry(0.16, 0.42, 16);
    this.tip = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: SUBTRACT_COLOR, depthTest: false, transparent: true }));
    this.tip.renderOrder = 11;
    const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: HANDLE_OUTLINE, side: THREE.BackSide, depthTest: false, transparent: true, opacity: 0.6 }));
    outline.scale.setScalar(1.2);
    outline.renderOrder = 10;
    this.tip.add(outline);
    this.arm = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: SUBTRACT_COLOR, depthTest: false, transparent: true }));
    this.arm.renderOrder = 10;
    this.group.renderOrder = 10;
    this.group.add(this.tip, this.arm);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Per frame: follow the push/pull arrow, point the other way, and wear the colour of the role Flip gives this side; the arrow itself takes its colour from the same roles. */
  update() {
    const handle = this.manipulator.pushPullHandle();
    const colors = arrowColors(this.state.flip);
    this.manipulator.pushPullRest = colors.normalSide;
    this.group.visible = handle !== null && !this.hidden;
    if (!handle) return;
    const dir = new THREE.Vector3(...handle.direction).multiplyScalar(-1);
    const anchor = new THREE.Vector3(...handle.anchor);
    this.group.position.copy(anchor);
    this.group.scale.setScalar(this.pixelSizeAt(anchor) * ARM_PX);
    this.arm.scale.setScalar(PUSH_PULL_ARM_RATIO);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.tip.position.copy(dir).multiplyScalar(PUSH_PULL_ARM_RATIO - 0.21);
    (this.tip.material as THREE.MeshBasicMaterial).color.setHex(colors.oppositeSide);
    (this.arm.material as THREE.LineBasicMaterial).color.setHex(colors.oppositeSide);
  }
}
