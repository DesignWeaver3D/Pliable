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
    faceGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3)); // its own copy of the triangles it shows (see `setTriangles`), so showing a mark never uploads the model's vertices
    this.face = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: true,
        side: THREE.DoubleSide, // a surface face is highlighted from both sides
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

  /** Show these triangles (corner numbers into `positions`; a copy is kept): a face, or every face of a body. */
  setTriangles(positions: ArrayLike<number>, corners: ArrayLike<number>) {
    const out = new Float32Array(corners.length * 3);
    for (let i = 0; i < corners.length; i++) {
      const p = corners[i] * 3;
      out[i * 3] = positions[p];
      out[i * 3 + 1] = positions[p + 1];
      out[i * 3 + 2] = positions[p + 2];
    }
    const geometry = this.face.geometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(out, 3));
    geometry.boundingSphere = null;
    geometry.boundingBox = null;
  }

  hide() {
    this.face.visible = this.edge.visible = this.vertex.visible = false;
  }
}
