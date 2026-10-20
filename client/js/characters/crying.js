// A fired worker sobs on the way out: hands over the face and little tear voxels flying off.
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { vox } from '../core/voxel.js';

const TEAR_EVERY_MS = 110, TEAR_LIFE_MS = 700, GRAVITY = 9;
const tearMat = new THREE.MeshBasicMaterial({ color: 0x6fb7ff });
const tears = []; // { mesh, velocity, born }

export function cry(p, now) {
  const u = p.userData;
  u.arms[0].rotation.set(-2.5, 0, .45); u.arms[1].rotation.set(-2.5, 0, -.45); // hands over the face
  u.head.rotation.x = .25 + Math.sin(now / 120) * .05;                          // sobbing
  if (now - (u.lastTear ?? 0) <= TEAR_EVERY_MS) return;
  u.lastTear = now;
  const side = tears.length % 2 ? 1 : -1, mesh = vox(scene, tearMat, [.09, .12, .09], [0, 0, 0]);
  mesh.castShadow = false;
  mesh.position.copy(p.localToWorld(new THREE.Vector3(side * .3, 2.45, .42)));
  tears.push({ mesh, velocity: new THREE.Vector3(side * .6, 1.2, 0).applyQuaternion(p.quaternion), born: now });
}

export function stepTears(dt, now) {
  for (let i = tears.length - 1; i >= 0; i--) {
    const tear = tears[i];
    tear.velocity.y -= GRAVITY * dt;
    tear.mesh.position.addScaledVector(tear.velocity, dt);
    if (now - tear.born > TEAR_LIFE_MS || tear.mesh.position.y < 0) { scene.remove(tear.mesh); tears.splice(i, 1); }
  }
}
