// A big satellite dish on a pedestal that turns its head left and right, wired to its office by a ground cable.
import * as THREE from 'three';
import { vox, material } from '../core/voxel.js';

const PEDESTAL_HEIGHT = 3.2, SCALE = 1.5; // big enough to read from across the map
const SWING = .55, SWING_PERIOD_MS = 3200, NOD = .08; // radians, head turn left/right + a little nod
const DISH = 0xf4f6f8, METAL = 0x8a929c, CABLE = 0x1d1d1d;
const blinkOn = new THREE.MeshBasicMaterial({ color: 0xff4040 }), blinkOff = material(0x5a1a1a);

const DISH_RADIUS = 2.3, FOCAL_LENGTH = 1.4; // a parabola z = r² / 4f, so the feed horn sits at the focus
const PIXEL = .26;                             // voxel size of the bowl
const RIM = 0xc3cad3;

// A round dish made of voxels: one column per grid cell inside the circle, pushed forward along the parabola,
// so it reads as a stepped round bowl opening towards +z. The outermost ring is a shade darker, like a rim.
function voxelBowl(parent) {
  const n = Math.floor(DISH_RADIUS / PIXEL);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const r = Math.hypot(i, j) * PIXEL;
    if (r > DISH_RADIUS) continue;
    const color = r > DISH_RADIUS - PIXEL * 1.2 ? RIM : DISH;
    vox(parent, color, [PIXEL, PIXEL, PIXEL * 1.8], [i * PIXEL, j * PIXEL - PIXEL / 2, r * r / (4 * FOCAL_LENGTH)]); // deep enough to close the steps
  }
}

// a strut as a dotted line of small voxels
function voxelLine(parent, from, to, size) {
  const steps = Math.ceil(from.distanceTo(to) / (size * .8));
  for (let k = 0; k <= steps; k++) {
    const p = from.clone().lerp(to, k / steps);
    vox(parent, METAL, [size, size, size], [p.x, p.y - size / 2, p.z]);
  }
}

function voxelDish(parent) {
  voxelBowl(parent);
  vox(parent, METAL, [.8, .8, .4], [0, -.4, -.35]); // hub on the back
  const depth = DISH_RADIUS ** 2 / (4 * FOCAL_LENGTH), focus = new THREE.Vector3(0, 0, FOCAL_LENGTH + .2);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + k * Math.PI * 2 / 3;
    voxelLine(parent, new THREE.Vector3(Math.cos(a) * (DISH_RADIUS - .2), Math.sin(a) * (DISH_RADIUS - .2), depth), focus, .1);
  }
  vox(parent, 0x444444, [.36, .36, .36], [focus.x, focus.y - .18, focus.z]); // feed horn
  vox(parent, 0x444444, [.24, .24, .2], [focus.x, focus.y - .12, focus.z - .26]);
}

// facing: yaw the dish rests at (it swings around it)
export function makeSatelliteDish(parent, x, z, facing) {
  const base = new THREE.Group(); base.position.set(x, 0, z); base.scale.setScalar(SCALE); parent.add(base);
  vox(base, 0x9a9a92, [3, .3, 3], [0, 0, 0]);           // concrete pad
  vox(base, METAL, [.7, PEDESTAL_HEIGHT, .7], [0, .3, 0]); // pedestal
  vox(base, 0x55606b, [1.1, .4, 1.1], [0, .3, 0]);
  const head = new THREE.Group(); head.position.y = .3 + PEDESTAL_HEIGHT; head.rotation.y = facing; base.add(head);
  vox(head, METAL, [1.2, .5, .9], [0, 0, 0]);          // yoke
  const tilt = new THREE.Group(); tilt.position.set(0, 1.6, .2); tilt.rotation.x = -.55; head.add(tilt); // looks up at the sky
  voxelDish(tilt);
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
