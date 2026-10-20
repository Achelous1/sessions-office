// A big satellite dish on a pedestal that turns its head left and right, wired to its office by a ground cable.
import * as THREE from 'three';
import { vox, material } from '../core/voxel.js';

const PEDESTAL_HEIGHT = 3.2, SCALE = 1.5; // big enough to read from across the map
const SWING = .55, SWING_PERIOD_MS = 3200, NOD = .08; // radians, head turn left/right + a little nod
const DISH = 0xf4f6f8, METAL = 0x8a929c, CABLE = 0x1d1d1d;
const blinkOn = new THREE.MeshBasicMaterial({ color: 0xff4040 }), blinkOff = material(0x5a1a1a);

const DISH_RADIUS = 2.3, FOCAL_LENGTH = 1.4; // a parabola y = r² / 4f, so the feed horn sits at the focus
const dishMat = new THREE.MeshLambertMaterial({ color: DISH, side: THREE.DoubleSide });
const strutMat = new THREE.MeshLambertMaterial({ color: METAL });

const shadowed = mesh => { mesh.castShadow = mesh.receiveShadow = true; return mesh; };

function cylinderBetween(parent, from, to, radius) {
  const length = from.distanceTo(to);
  const mesh = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), strutMat));
  mesh.position.copy(from).lerp(to, .5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  parent.add(mesh);
}

// A round parabolic dish opening towards +z, with a rolled rim, a back hub, three struts and the feed horn.
function roundDish(parent) {
  const profile = Array.from({ length: 13 }, (_, i) => {
    const r = DISH_RADIUS * i / 12;
    return new THREE.Vector2(r, r * r / (4 * FOCAL_LENGTH));
  });
  const bowl = shadowed(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), dishMat));
  bowl.rotation.x = Math.PI / 2; // lathe axis y -> z
  parent.add(bowl);
  const depth = DISH_RADIUS ** 2 / (4 * FOCAL_LENGTH);
  const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(DISH_RADIUS, .07, 8, 48), strutMat));
  rim.position.z = depth;
  parent.add(rim);
  const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, .4, 16), strutMat));
  hub.rotation.x = Math.PI / 2; hub.position.z = -.15;
  parent.add(hub);
  const focus = new THREE.Vector3(0, 0, FOCAL_LENGTH);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + k * Math.PI * 2 / 3;
    cylinderBetween(parent, new THREE.Vector3(Math.cos(a) * DISH_RADIUS, Math.sin(a) * DISH_RADIUS, depth), focus, .035);
  }
  const horn = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(.12, .2, .4, 12), new THREE.MeshLambertMaterial({ color: 0x444444 })));
  horn.rotation.x = -Math.PI / 2; horn.position.copy(focus);
  parent.add(horn);
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
  roundDish(tilt);
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
