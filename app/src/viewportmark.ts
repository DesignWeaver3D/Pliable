import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

/** A highlight of one face, edge or vertex, drawn over the model. */
export class Mark {
  readonly face: THREE.Mesh;
  readonly edge: LineSegments2;
  readonly vertex: THREE.Points;
  readonly lineMaterial: LineMaterial; // not a parameter property: the node tests run this file with types stripped

  constructor(parent: THREE.Object3D, source: THREE.BufferGeometry, color: number, opacity: number, lineMaterial: LineMaterial) {
    this.lineMaterial = lineMaterial;
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", source.getAttribute("position"));
    faceGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this.face = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.edge = new LineSegments2(new LineSegmentsGeometry(), lineMaterial);
    this.vertex = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }),
    );
    for (const object of [this.face, this.edge, this.vertex]) {
      object.visible = false;
      object.renderOrder = 2;
      parent.add(object);
    }
  }

  hide() {
    this.face.visible = this.edge.visible = this.vertex.visible = false;
  }
}
