// A blocky office worker, its basic poses, and small idle gestures.
import * as THREE from 'three';
import { vox } from '../core/voxel.js';
import { SKIN, SHIRT, HAIR, hash } from '../world/palette.js';

const TROUSERS = 0x2c3e50, SHOES = 0x1a1a1a, EYES = 0x111111;
const HEAD_CENTER = 2.5;

// legs pivot at the hip and the knee, so sitting folds forward (+z = facing direction)
function leg(parent, x) {
  const hip = new THREE.Group(); hip.position.set(x, 1, 0); parent.add(hip);
  vox(hip, TROUSERS, [.36, .5, .4], [0, -.5, 0]);
  const knee = new THREE.Group(); knee.position.set(0, -.5, 0); hip.add(knee);
  vox(knee, TROUSERS, [.36, .5, .4], [0, -.5, 0]);
  vox(knee, SHOES, [.38, .14, .55], [0, -.5, .08]);
  return { hip, knee };
}

// The seed (session id) picks skin, shirt and hair, so a session always looks the same.
export function person(seed, shirt) {
  const g = new THREE.Group(), h = hash(seed), u = g.userData;
  const skin = SKIN[h % SKIN.length];
  shirt ??= SHIRT[(h >> 3) % SHIRT.length];
  u.legs = [leg(g, -.2), leg(g, .2)];
  vox(g, shirt, [1, 1.1, .6], [0, 1, 0]);
  // face and hair hang off a head group that pivots at the head's center, so they turn and nod with it
  u.head = new THREE.Group(); u.head.position.y = HEAD_CENTER; g.add(u.head);
  vox(u.head, skin, [.8, .8, .8], [0, -.4, 0]);
  vox(u.head, HAIR[(h >> 6) % HAIR.length], [.85, .25, .85], [0, .35, 0]);
  vox(u.head, EYES, [.12, .12, .05], [-.18, .05, .41]); vox(u.head, EYES, [.12, .12, .05], [.18, .05, .41]);
  u.arms = [-1, 1].map(side => {
    const arm = new THREE.Group(); arm.position.set(side * .65, 2, 0); g.add(arm);
    vox(arm, shirt, [.3, .9, .3], [0, -.9, 0]); vox(arm, skin, [.3, .2, .3], [0, -1.1, 0]);
    return arm;
  });
  u.item = vox(u.arms[1], 0xffffff, [.28, .32, .28], [0, -1.35, .12]); // cup / snack / paddle in the right hand
  u.item.visible = false;
  return g;
}

// kind: 'stand' | 'sit' | 'walk'. Resets head and arms, so gestures are applied after the pose.
// userData.baseY lifts a person off the ground floor (the cloud office).
export function pose(p, kind, now, phase = 0) {
  const u = p.userData, [left, right] = u.legs, [leftArm, rightArm] = u.arms;
  const swing = kind === 'walk' ? Math.sin(now / 90 + phase) * .6 : 0;
  const sit = kind === 'sit';
  left.hip.rotation.x = sit ? -Math.PI / 2 : swing; right.hip.rotation.x = sit ? -Math.PI / 2 : -swing;
  left.knee.rotation.x = sit ? Math.PI / 2 : Math.max(0, -swing) * 1.2; right.knee.rotation.x = sit ? Math.PI / 2 : Math.max(0, swing) * 1.2;
  leftArm.rotation.set(-swing, 0, 0); rightArm.rotation.set(swing, 0, 0);
  u.head.rotation.set(0, 0, 0);
  p.position.y = (u.baseY ?? 0) + (sit ? -.3 : (kind === 'walk' ? Math.abs(Math.sin(now / 90 + phase)) * .08 : 0));
}

// raise the right hand to the mouth every `period` ms (drinking / eating)
export function sip(p, now, period, phase) {
  const t = ((now + phase) % period) / period, up = t < .3 ? Math.sin(t / .3 * Math.PI) : 0;
  p.userData.arms[1].rotation.set(-.5 - up * 1.5, 0, -up * .35);
  p.userData.head.rotation.x = -up * .15;
}
