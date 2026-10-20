// A big satellite dish on a pedestal that turns its head left and right, wired to its office by a ground cable.
import * as THREE from 'three';
import { vox, material } from '../core/voxel.js';

const PEDESTAL_HEIGHT = 3.2, SCALE = 1.5; // big enough to read from across the map
const SWING = .55, SWING_PERIOD_MS = 3200, NOD = .08; // radians, head turn left/right + a little nod
const DISH = 0xf4f6f8, METAL = 0x8a929c, CABLE = 0x1d1d1d;
const blinkOn = new THREE.MeshBasicMaterial({ color: 0xff4040 }), blinkOff = material(0x5a1a1a);

// two crossed plates make a voxel octagon of the given diameter, centered on the tilt axis
function octagon(parent, size, z) {
  const narrow = size * .62;
  vox(parent, DISH, [size, narrow, .18], [0, -narrow / 2, z]);
  vox(parent, DISH, [narrow, size, .18], [0, -size / 2, z]);
}

// facing: yaw the dish rests at (it swings around it)
export function makeSatelliteDish(parent, x, z, facing) {
  const base = new THREE.Group(); base.position.set(x, 0, z); base.scale.setScalar(SCALE); parent.add(base);
  vox(base, 0x9a9a92, [3, .3, 3], [0, 0, 0]);           // concrete pad
  vox(base, METAL, [.7, PEDESTAL_HEIGHT, .7], [0, .3, 0]); // pedestal
  vox(base, 0x55606b, [1.1, .4, 1.1], [0, .3, 0]);
  const head = new THREE.Group(); head.position.y = .3 + PEDESTAL_HEIGHT; head.rotation.y = facing; base.add(head);
  vox(head, METAL, [1.2, .5, .9], [0, 0, 0]);          // yoke
  const tilt = new THREE.Group(); tilt.position.y = .6; tilt.rotation.x = -.55; head.add(tilt); // looks up at the sky
  // stepped bowl: wider octagonal plates further forward, so from the front it reads as a round dish
  [[1.6, 0], [2.8, .25], [3.8, .5], [4.6, .72]].forEach(([size, zOffset]) => octagon(tilt, size, zOffset));
  vox(tilt, METAL, [.12, .12, 2.4], [0, -.06, 2]);       // feed arm
  vox(tilt, 0x444444, [.45, .45, .45], [0, -.22, 3.2]);  // horn
  const light = vox(head, blinkOn, [.2, .2, .2], [0, .5, 0]);
  light.castShadow = false;
  return { head, light, facing, phase: Math.random() * 1000 };
}

export function animateDish(dish, now) {
  const t = (now + dish.phase) / SWING_PERIOD_MS * Math.PI * 2;
  dish.head.rotation.y = dish.facing + Math.sin(t) * SWING;
  dish.head.rotation.x = Math.sin(t * 2) * NOD;
  dish.light.material = (now + dish.phase) % 1200 < 300 ? blinkOn : blinkOff;
}

// An L-shaped cable on the floor from (x0, z0) to (x1, z1), with a small clip every few units.
export function layCable(parent, [x0, z0], [x1, z1]) {
  const run = (a, b, along) => {
    const length = Math.abs(b - a), mid = (a + b) / 2;
    if (length < .01) return;
    vox(parent, CABLE, along === 'x' ? [length, .14, .14] : [.14, .14, length], along === 'x' ? [mid, .02, z0] : [x1, .02, mid]);
    for (let d = 1.5; d < length; d += 3) {
      const p = Math.min(a, b) + d;
      vox(parent, 0x777777, [.22, .2, .22], along === 'x' ? [p, 0, z0] : [x1, 0, p]);
    }
  };
  run(x0, x1, 'x');
  run(z0, z1, 'z');
}
