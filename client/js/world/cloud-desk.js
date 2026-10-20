// Cloud office furniture: every cloud session gets its own little cloud to sit on, with a desk and a chair
// that are clouds too. Built in desk-local space like the regular desk (desk at the origin, chair on +z).
import * as THREE from 'three';
import { vox } from '../core/voxel.js';

// lit a little from within, so the shaded sides stay white instead of turning grey
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a93a3 });
const cloudShade = new THREE.MeshLambertMaterial({ color: 0xe9eef6, emissive: 0x7a8394 });

// a puff is a small stack of boxes, wide at the bottom and rounder on top; (x, y, z) is its bottom center
function puff(parent, x, y, z, w, d, h = Math.min(w, d) * .55, mat = cloudMat) {
  vox(parent, mat, [w, h * .6, d * .8], [x, y, z]);
  vox(parent, mat, [w * .8, h * .6, d], [x, y, z]);
  vox(parent, mat, [w * .6, h * .4, d * .6], [x, y + h * .6, z]);
}

export function buildCloudDesk(g) {
  // the cloud they float on: top at y 0 under the desk and the chair
  for (const [x, z, w, d] of [[0, .4, 4.4, 4.2], [-1.6, 1.8, 2, 2], [1.7, -.4, 2, 2], [.3, 2.6, 2.4, 1.8], [-1.2, -1, 2.2, 1.6]]) {
    puff(g, x, -1.1, z, w, d, 1.1, cloudShade);
  }
  for (const [x, z, s] of [[-2.3, .2, 1.1], [2.3, 1, 1], [1, 3.2, .9], [-1.4, 3, .8]]) puff(g, x, -.5, z, s, s); // fluffy edge
  // desk: a flat-topped cloud the laptop rests on (top at y 1.3, like the wooden desk)
  puff(g, 0, .2, 0, 2.6, 1.2, .9);
  vox(g, cloudMat, [3, .3, 1.5], [0, 1, 0]);
  for (const x of [-1.25, 1.25]) puff(g, x, 1.05, 0, .7, .9, .5);
  // chair: a round cushion with a little cloud backrest
  puff(g, 0, 0, 1.6, 1.2, 1.2, .55);
  puff(g, 0, .45, 2.15, 1.1, .45, .9);
}
