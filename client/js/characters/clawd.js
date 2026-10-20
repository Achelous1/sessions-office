// Clawd: one little voxel Claude per running subagent, perched around the worker's laptop.
import * as THREE from 'three';
import { vox, material, pixelArt } from '../core/voxel.js';
import { CLAUDE_ORANGE } from '../world/palette.js';

// Desk-local spots (+z faces the worker; the chair sits at z 1.6): beside the laptop, on the screen, back corners,
// on the worker's head ('head' = rides along with the person), then the floor around the chair.
// The floor beside the desk is skipped on purpose: in a pod that is under the neighbour's desk.
const SPOTS = [
  [-.95, 1.3, 0], [.8, 1.3, -.2], [-.3, 2.17, -.45], [.3, 2.17, -.45], [-1.3, 1.3, -.55], [1.3, 1.3, -.55],
  [0, 3.1, 0, 'head'],
  [-.85, 0, 1.5], [.85, 0, 1.5], [0, 0, 2.6], [-.75, 0, 2.7], [.75, 0, 2.7],
];
const bodyMat = material(CLAUDE_ORANGE), eyeMat = material(0x1a1a1a);
const EYE_PIXEL = .035, EYE_HEIGHT = .17;

// Faces as pixel art, one string per row from the top ('#' = eye pixel); both eyes match unless a pair is given.
const FACES = {
  tall:   ['#', '#', '#'],                              // | |  default
  squint: [['#..', '.#.', '#..'], ['..#', '.#.', '..#']], // > <  straining
  happy:  ['.#.', '#.#'],                               // ^ ^
  dot:    ['#'],                                        // . .  focused
  blink:  ['###'],                                      // - -
};
const FACE_POOL = ['tall', 'tall', 'tall', 'squint', 'squint', 'happy', 'dot'];
const BLINK_EVERY_MS = 2600, BLINK_MS = 130;

function makeFace(art) {
  const face = new THREE.Group();
  face.visible = false;
  const [left, right] = typeof art[0] === 'string' ? [art, art] : art;
  for (const [rows, x] of [[left, -.12], [right, .12]]) {
    const y = EYE_HEIGHT - EYE_PIXEL / 2 - (rows.length - 1) / 2 * EYE_PIXEL; // eyes centered on EYE_HEIGHT
    pixelArt(face, eyeMat, rows, EYE_PIXEL, .02, { x, y, z: .13 });
  }
  return face;
}

function makeClawd() {
  const g = new THREE.Group(), u = g.userData;
  const body = new THREE.Group(); body.position.y = .12; g.add(body); // rocks and squashes around its feet
  vox(body, bodyMat, [.5, .3, .26], [0, 0, 0]);
  u.arms = [-.3, .3].map(x => vox(body, bodyMat, [.1, .08, .14], [x, .08, 0]));
  for (const x of [-.18, -.06, .06, .18]) vox(g, bodyMat, [.06, .12, .08], [x, 0, 0]);
  u.faces = {};
  for (const [name, art] of Object.entries(FACES)) body.add(u.faces[name] = makeFace(art));
  u.face = 'tall'; u.faces.tall.visible = true; u.body = body;
  u.seed = Math.random() * 10; u.nextFace = 0;
  return g;
}

function showFace(clawd, name) {
  const u = clawd.userData;
  u.faces[u.shown ?? u.face].visible = false;
  u.faces[name].visible = true;
  u.shown = name;
}

export function animateClawd(clawd, now) {
  const u = clawd.userData, t = now / 1000 + u.seed;
  // working wobble: rock side to side, squash and stretch, hop, arms tapping in turn
  clawd.position.y = u.base + Math.abs(Math.sin(t * 4.5)) * .07;
  clawd.rotation.y = Math.sin(t * 1.7) * .35;
  u.body.rotation.z = Math.sin(t * 6) * .16;
  const squash = Math.sin(t * 9) * .07; u.body.scale.set(1 - squash * .6, 1 + squash, 1);
  u.arms[0].position.y = .12 + Math.max(0, Math.sin(t * 11)) * .07;
  u.arms[1].position.y = .12 + Math.max(0, -Math.sin(t * 11)) * .07;
  // expressions: pick a new one every 1.5-4s, blink now and then while wide-eyed
  if (now > u.nextFace) { u.face = FACE_POOL[Math.floor(Math.random() * FACE_POOL.length)]; u.nextFace = now + 1500 + Math.random() * 2500; }
  const blinking = u.face === 'tall' && (t * 1000) % BLINK_EVERY_MS < BLINK_MS;
  const want = blinking ? 'blink' : u.face;
  if (want !== u.shown) showFace(clawd, want);
}

// Adds or removes Clawds so the desk shows `count` of them (at most one per spot).
export function syncClawds(desk, count) {
  count = Math.min(count, SPOTS.length);
  while (desk.clawds.length < count) {
    const clawd = makeClawd(), [x, y, z, on] = SPOTS[desk.clawds.length];
    clawd.position.set(x, y, z); clawd.userData.base = y;
    (on === 'head' ? desk.worker.obj : desk.group).add(clawd);
    desk.clawds.push(clawd);
  }
  while (desk.clawds.length > count) { const clawd = desk.clawds.pop(); clawd.parent.remove(clawd); }
}
