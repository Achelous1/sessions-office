// Voxel interpretation of Codex's default blue companion: cloud-shaped head, navy face and cyan >_ eyes.
import * as THREE from 'three';
import { vox, pixelArt } from '../core/voxel.js';

const BLUE = 0x5278ec, LIGHT = 0x789bff, SHADE = 0x3857bd, SCREEN = 0x192b60;
// The terminal face stays legible at desk scale and in the office's night lighting.
const cyan = new THREE.MeshBasicMaterial({ color: 0xa0f5ef });
const screen = new THREE.MeshBasicMaterial({ color: SCREEN });
const FACES = {
  tall: [['#..', '.#.', '..#', '.#.', '#..'], ['...', '...', '...', '...', '###']],
  squint: [['#..', '.#.', '..#', '.#.', '#..'], ['..#', '.#.', '#..', '.#.', '..#']],
  happy: ['.#.', '#.#'],
  dot: ['#', '#', '#'],
  blink: ['###'],
};

function face(art) {
  const group = new THREE.Group();
  const [left, right] = typeof art[0] === 'string' ? [art, art] : art;
  for (const [rows, x] of [[left, -.075], [right, .075]]) {
    pixelArt(group, cyan, rows, .022, .012, { x, y: .25 - rows.length * .011, z: .171, castShadow: false });
  }
  group.visible = false;
  return group;
}

export function makeCodexCompanion() {
  const group = new THREE.Group(), u = group.userData;
  u.kind = 'codex';
  const body = new THREE.Group(); body.position.y = .08; group.add(body);
  // A small torso and boots under a large, stepped blue head.
  vox(body, BLUE, [.25, .14, .18], [0, 0, 0]);
  vox(body, LIGHT, [.19, .1, .015], [0, .025, .098]);
  for (const x of [-.075, .075]) vox(group, SHADE, [.085, .08, .12], [x, 0, .015]);
  u.arms = [-.18, .18].map(x => vox(body, BLUE, [.075, .12, .1], [x, .015, 0]));
  u.armBase = .075;
  vox(body, BLUE, [.42, .26, .27], [0, .13, 0]);
  for (const x of [-.23, .23]) vox(body, BLUE, [.075, .17, .23], [x, .18, 0]);
  vox(body, LIGHT, [.32, .055, .23], [0, .39, 0]);
  for (const x of [-.09, .09]) vox(body, LIGHT, [.13, .04, .19], [x, .43, 0]);
  vox(body, SHADE, [.36, .22, .025], [0, .145, .14]);
  vox(body, screen, [.32, .18, .02], [0, .165, .158]);
  pixelArt(body, cyan, ['#....', '.#...', '#.###'], .014, .012, { x: 0, y: .055, z: .11, castShadow: false });
  u.faces = {};
  for (const [name, art] of Object.entries(FACES)) body.add(u.faces[name] = face(art));
  u.face = 'tall'; u.faces.tall.visible = true; u.body = body;
  u.seed = Math.random() * 10; u.nextFace = 0;
  return group;
}
