// The static office: floors, walls, windows, pods, pantry, lounge, lamps. Rebuilt whenever the layout grows.
import * as THREE from 'three';
import { scene, camera, controls } from '../core/engine.js';
import { vox, glassMaterial as glass } from '../core/voxel.js';
import { applyTheme, addLamp, clearLamps } from '../core/theme.js';
import { createSeasonalEvents } from '../core/seasonal-events.js';
import { halloweenEvent } from './halloween.js';
import { desks } from './state.js';
import { visitorAgent } from './visitor.js';
import { overlayElement, pin } from '../core/overlay.js';
import { L, podOf, hangoutSpots } from './layout.js';
import { CHAIR, POD_RUG, BEANBAG, VISITOR_SHIRT } from './palette.js';

const WALL_HEIGHT = 5;
const WALL_COLOR = 0xe8e2d6;
const WOOD = [0xc9a57b, 0xbf9a6f, 0xd2ae84];

const room = new THREE.Group();
scene.add(room);
const seasonalEvents = createSeasonalEvents([halloweenEvent]);
export const stepRoomEvents = now => seasonalEvents.update(now);

// ---------- zone signs ----------
const zones = [
  { sign: overlayElement('zone', '탕비실'), anchor: new THREE.Object3D() },
  { sign: overlayElement('zone', '입구'), anchor: new THREE.Object3D() },
];
const [pantryZone, entryZone] = zones;
zones.forEach(z => scene.add(z.anchor));
export function pinZoneSigns() { for (const z of zones) pin(z.sign, z.anchor, 0); }

// ---------- Sims-style cutaway ----------
// Walls between the camera and the room drop to knee height and their decor hides.
const walls = []; // { group, normal: inward normal, height: 0..1 }
const CUTAWAY_HEIGHT = .14;
export function updateWalls(dt) {
  const dx = camera.position.x - controls.target.x, dz = camera.position.z - controls.target.z, len = Math.hypot(dx, dz) || 1;
  for (const w of walls) {
    const cameraOutside = (dx * w.normal.x + dz * w.normal.z) / len < -.2;
    w.height += ((cameraOutside ? CUTAWAY_HEIGHT : 1) - w.height) * Math.min(1, dt * 8);
    w.group.scale.y = w.height;
    for (const child of w.group.children) if (!child.userData.wall) child.visible = w.height > .6;
  }
}

function plant(x, z, s = 1) {
  vox(room, 0x8b5a2b, [.8 * s, .8 * s, .8 * s], [x, 0, z]);
  vox(room, 0x2e8b57, [1.1 * s, .9 * s, 1.1 * s], [x, .8 * s, z]);
  vox(room, 0x3cb371, [.7 * s, .7 * s, .7 * s], [x + .1, 1.7 * s, z - .1]);
  vox(room, 0x2e8b57, [.4 * s, .5 * s, .4 * s], [x - .1, 2.4 * s, z + .1]);
}

// staggered wood planks in the office, light tiles in the pantry
function buildFloors() {
  const { LX, PX, RX, back, front } = L;
  for (let x = PX; x < LX; x += 2) for (let z = back; z < front; z += 2) {
    const light = ((x - PX) / 2 + (z - back) / 2) & 1, w = Math.min(2, LX - x); // last column stops at the partition
    vox(room, light ? 0xdedad2 : 0xc9c4ba, [w, .4, Math.min(2, front - z)], [x + w / 2, -.4, z + Math.min(1, (front - z) / 2)]);
  }
  for (let z = back, row = 0; z < front; z++, row++) for (let x = LX - (row % 2) * 2; x < RX; x += 4) {
    const x0 = Math.max(x, LX), x1 = Math.min(x + 4, RX);
    const shade = WOOD[((row * 7 + Math.round(x)) % 3 + 3) % 3];
    vox(room, shade, [x1 - x0 - .04, .4, Math.min(1, front - z) - .04], [(x0 + x1) / 2, -.4, z + Math.min(1, front - z) / 2]);
  }
}

// one group per side, so the side facing the camera can collapse (see updateWalls)
function buildWalls() {
  const { PX, RX, back, front, EZ } = L, H = WALL_HEIGHT;
  walls.length = 0;
  const side = (nx, nz) => {
    const group = new THREE.Group(); room.add(group);
    walls.push({ group, normal: { x: nx, z: nz }, height: 1 });
    return group;
  };
  const W = { back: side(0, 1), front: side(0, -1), west: side(1, 0), east: side(-1, 0) };
  const wall = (group, size, pos, color = WALL_COLOR) => { vox(group, color, size, pos).userData.wall = true; };
  wall(W.back, [RX - PX + .8, H, .4], [(PX + RX) / 2, 0, back - .2]);
  wall(W.front, [RX - PX + .8, H, .4], [(PX + RX) / 2, 0, front + .2]);
  wall(W.west, [.4, H, front - back], [PX - .2, 0, (back + front) / 2]);
  wall(W.east, [.4, H, EZ - 1.6 - back], [RX + .2, 0, (back + EZ - 1.6) / 2]);
  wall(W.east, [.4, H, front - EZ - 1.6], [RX + .2, 0, (EZ + 1.6 + front) / 2]);
  wall(W.east, [.4, H - 4.4, 3.2], [RX + .2, 4.4, EZ]); // over the door
  const BASEBOARD = 0x6b5b4b;
  wall(W.back, [RX - PX, .25, .1], [(PX + RX) / 2, 0, back + .05], BASEBOARD);
  wall(W.front, [RX - PX, .25, .1], [(PX + RX) / 2, 0, front - .05], BASEBOARD);
  wall(W.west, [.1, .25, front - back], [PX + .05, 0, (back + front) / 2], BASEBOARD);
  return W;
}

// door frame + door swung open against the outer wall
function buildEntrance(W) {
  const { RX, EZ } = L, FRAME = 0x4a3b2c;
  vox(W.east, FRAME, [.5, 4.4, .3], [RX + .2, 0, EZ - 1.6]);
  vox(W.east, FRAME, [.5, 4.4, .3], [RX + .2, 0, EZ + 1.6]);
  vox(W.east, FRAME, [.5, .4, 3.5], [RX + .2, 4, EZ]);
  vox(W.east, 0xa0764a, [.15, 3.8, 2.9], [RX + .5, 0, EZ - 3.1]);
  vox(room, VISITOR_SHIRT, [2, .05, 3], [RX - 1.2, 0, EZ]); // door mat
  entryZone.anchor.position.set(RX, 5.2, EZ);
}

// along x on the back/front walls, along z on the west wall
function buildWindows(W) {
  const { LX, PX, RX, back, front } = L, FRAME = 0x55606b;
  const addWindow = (group, x, z, alongX, inward) => {
    const [w, d] = alongX ? [1, 0] : [0, 1];
    vox(group, FRAME, [3.4 * w + .2 * d, 2.4, 3.4 * d + .2 * w], [x, 1.8, z]);
    vox(group, glass, [3 * w + .1 * d, 2, 3 * d + .1 * w], [x + inward.x * .15, 2, z + inward.z * .15]);
    vox(group, FRAME, [.1 * w + .15 * d, 2, .1 * d + .15 * w], [x + inward.x * .15, 2, z + inward.z * .15]);
  };
  for (let x = PX + 3; x < RX - 2; x += 5) {
    if (x > LX - 2 && x < LX + 2) continue; // partition
    if (x < 9) addWindow(W.back, x, back + .05, true, { x: 0, z: 1 }); // the neon sign hangs further east
    addWindow(W.front, x, front - .05, true, { x: 0, z: -1 });
  }
  for (let z = back + 9; z < front - 3; z += 5) addWindow(W.west, PX + .05, z, false, { x: 1, z: 0 });
}

// free-standing whiteboard (pulled off the wall so it never z-fights the windows), clock, cabinets, plants
function buildOfficeDecor(W) {
  const { LX, RX, back, front } = L, wb = back + 1;
  vox(room, 0x888888, [6.4, 2.8, .15], [-1.5, 1.1, wb]);
  vox(room, 0xffffff, [6, 2.4, .1], [-1.5, 1.3, wb + .1]);
  [[0xd9534f, -3.5, 2.8, 1.6], [0x3b6fd8, -2, 2.3, 2.2], [0x5cb85c, .2, 2.9, 1.2], [0x3b6fd8, .8, 2, 1.8]]
    .forEach(([c, x, y, w]) => vox(room, c, [w, .12, .05], [x, y, wb + .17]));
  vox(room, 0x333333, [6, .15, .3], [-1.5, 1.1, wb + .2]);
  for (const x of [-4.85, 1.85]) { vox(room, 0x666666, [.15, 3.9, .15], [x, 0, wb]); vox(room, 0x555555, [.25, .1, .9], [x, 0, wb]); }
  vox(W.back, 0xffffff, [1, 1, .1], [8, 3.6, back + .2]); // clock
  vox(W.back, 0x222222, [.08, .4, .05], [8, 4.1, back + .27]);
  vox(W.back, 0x222222, [.3, .08, .05], [8.15, 4.06, back + .27]);
  for (const x of [4, 5.1, 6.2]) { // filing cabinets
    vox(room, 0x8a9199, [1, 1.6, .9], [x, 0, back + .6]);
    vox(room, 0x5c636b, [.4, .08, .05], [x, .5, back + 1.06]); vox(room, 0x5c636b, [.4, .08, .05], [x, 1.2, back + 1.06]);
  }
  plant(RX - .8, back + .7); plant(LX + 1, back + .7, .8); plant(4, front - .6, .7); plant(LX + 1, front - .6, .7);
}

// felt divider between facing desks with a few desk plants on top, and a rug per pod
function buildPods() {
  for (let p = 0; p < L.pods; p++) {
    const pod = podOf(p), g = new THREE.Group();
    g.position.set(pod.cx, 0, pod.cz); g.rotation.y = pod.rot; room.add(g);
    vox(g, 0x7a9a7e, [6.6, .7, .12], [0, 1.3, 0]);
    for (const x of [-2.4, 0, 2.4]) { vox(g, 0xf2f2f2, [.35, .3, .35], [x, 2, 0]); vox(g, 0x3cb371, [.45, .35, .45], [x, 2.3, 0]); }
    vox(g, POD_RUG[p % POD_RUG.length], [7.6, .03, 7.6], [0, 0, 0]);
  }
}

// an odd pod count leaves one cell empty: it becomes a meeting corner
function buildMeetingCorner() {
  if (L.pods % 2 === 0) return;
  const { cx, cz } = podOf(L.pods);
  vox(room, 0xffffff, [4, .15, 2], [cx, 1, cz]);
  vox(room, 0x444444, [.3, 1, .3], [cx - 1.3, 0, cz]); vox(room, 0x444444, [.3, 1, .3], [cx + 1.3, 0, cz]);
  for (const [x, z] of [[-1.2, -1.8], [1.2, -1.8], [-1.2, 1.8], [1.2, 1.8]]) {
    vox(room, CHAIR[(x > 0) + (z > 0) * 2], [.9, .2, .9], [cx + x, .35, cz + z]);
    vox(room, 0x555555, [.15, .35, .15], [cx + x, 0, cz + z]);
  }
  vox(room, 0xffffff, [3, 2, .1], [cx, 1, cz - 3.6]); // rolling whiteboard
  vox(room, 0x888888, [.1, 1, .1], [cx - 1.2, 0, cz - 3.6]); vox(room, 0x888888, [.1, 1, .1], [cx + 1.2, 0, cz - 3.6]);
  [[0xd9534f, -.6, 2.5], [0x3b6fd8, .3, 2.1], [0x5cb85c, -.2, 1.7]].forEach(([c, x, y]) => vox(room, c, [1.2, .1, .05], [cx + x, y, cz - 3.53]));
  plant(cx + 3.5, cz + 3.5, 1.1);
}

function neonSign(text) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 84px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff4fa3'; ctx.shadowBlur = 24; ctx.fillStyle = '#ffd1ea';
  ctx.fillText(text, 256, 66); ctx.fillText(text, 256, 66); // twice for a stronger glow
  return new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
}

// rug, beanbags around a coffee table, ping-pong table, neon sign
function buildLounge(W) {
  const { back } = L;
  vox(room, 0xe9c46a, [6.6, .03, 4.8], [12.3, 0, back + 3.6]);
  vox(room, 0x8b6b4a, [1.4, .45, 1], [12.3, 0, back + 4.6]);
  vox(room, 0xffffff, [.25, .3, .25], [12, .45, back + 4.5]); vox(room, 0xf0ad4e, [.5, .1, .35], [12.6, .45, back + 4.7]);
  hangoutSpots().filter(s => s.act === 'beanbag').forEach((s, i) => {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z); g.rotation.y = s.yaw; room.add(g);
    vox(g, BEANBAG[i], [1.3, .5, 1.3], [0, 0, 0]); vox(g, BEANBAG[i], [1.3, 1, .5], [0, 0, -.6]);
  });
  vox(room, 0x1f7a4d, [2.8, .1, 1.6], [12, .85, back + 8.5]); // ping-pong table
  vox(room, 0xffffff, [2.8, .02, .05], [12, .95, back + 8.5]);
  vox(room, 0xffffff, [.05, .25, 1.7], [12, .95, back + 8.5]);
  for (const x of [11, 13]) vox(room, 0x333333, [.15, .85, 1.2], [x, 0, back + 8.5]);
  vox(room, 0xffffff, [.15, .15, .15], [11.3, 1.3, back + 8.3]); // ball
  const sign = neonSign('SHIP IT');
  sign.position.set(12.3, 3.4, back + .25); W.back.add(sign);
  vox(W.back, 0x3a2f4a, [5.6, 1.7, .1], [12.3, 2.55, back + .15]);
  plant(9, back + .7, .9);
}

// pendant lamps over pods, lounge and pantry table: only lit at night
function buildLamps() {
  clearLamps();
  const lampAt = (x, z) => {
    vox(room, 0x333333, [.05, 1.2, .05], [x, 5, z]); vox(room, 0x2b2b2b, [1, .4, 1], [x, 4.6, z]);
    const bulb = vox(room, new THREE.MeshBasicMaterial({ color: 0xfff1c9 }), [.5, .1, .5], [x, 4.52, z]); bulb.castShadow = false;
    const light = new THREE.PointLight(0xffd9a0, 0, 16, 1.4); light.position.set(x, 4.2, z); room.add(light);
    addLamp(light, bulb);
  };
  for (let p = 0; p < L.pods; p++) { const pod = podOf(p); lampAt(pod.cx, pod.cz); }
  lampAt(12.3, L.back + 4); lampAt(-21, L.DZ + 2);
  applyTheme();
}

// glass partition with a doorway into the pantry
function buildPartition() {
  const { LX, back, front, DZ } = L, FRAME = 0x9aa1ad;
  for (const [z0, z1] of [[back, DZ - 1.6], [DZ + 1.6, front]]) {
    vox(room, FRAME, [.3, 1.2, z1 - z0], [LX, 0, (z0 + z1) / 2]);
    vox(room, glass, [.15, 2.2, z1 - z0], [LX, 1.2, (z0 + z1) / 2]);
    vox(room, FRAME, [.35, .15, z1 - z0], [LX, 3.4, (z0 + z1) / 2]);
  }
  vox(room, FRAME, [.35, .3, 3.2], [LX, 3.4, DZ]);
  pantryZone.anchor.position.set(LX, 4.4, DZ);
}

function buildPantry(W) {
  const { LX, PX, back, front, DZ } = L;
  // counter with coffee machine, snacks, microwave
  vox(room, 0x8b6b4a, [10, 1.1, 1.2], [-21, 0, back + .6]);
  vox(room, 0xf5f5f5, [10.2, .12, 1.3], [-21, 1.1, back + .65]);
  vox(W.back, 0x8b6b4a, [10, 1.2, .7], [-21, 3, back + .35]); // wall cabinets
  vox(room, 0x222222, [.9, 1.1, .8], [-24, 1.22, back + .6]); vox(room, 0xd9534f, [.15, .15, .05], [-23.8, 1.9, back + 1.02]);
  vox(room, 0xffffff, [.3, .35, .3], [-24.1, 1.22, back + 1.05]);
  [[0xf0ad4e, -21.6], [0xd9534f, -21], [0x5bc0de, -20.4], [0x9b59b6, -19.2], [0xf0ad4e, -18.6]]
    .forEach(([c, x], i) => vox(room, c, [.5, .5 + (i % 2) * .2, .4], [x, 1.22, back + .6]));
  vox(room, 0xcfcfcf, [1.2, .7, .8], [-17, 1.22, back + .6]); vox(room, 0x222222, [.7, .45, .05], [-17.15, 1.35, back + 1.01]);
  // water cooler + fridge on the west wall
  vox(room, 0xf2f2f2, [.9, 1.5, .9], [PX + .7, 0, back + 3]);
  vox(room, 0x6fb7ff, [.6, .8, .6], [PX + .7, 1.5, back + 3]);
  vox(room, 0x3b6fd8, [.15, .15, .1], [PX + 1.2, 1.1, back + 3]);
  vox(room, 0xc8ccd0, [1.3, 2.8, 1.3], [PX + .8, 0, back + 6.5]);
  vox(room, 0x777777, [.08, .9, .1], [PX + 1.5, 1.6, back + 6.1]); vox(room, 0x777777, [.08, .6, .1], [PX + 1.5, .6, back + 6.1]);
  // table + stools
  vox(room, 0xa0764a, [2.6, .15, 2.6], [-21, .95, DZ + 2]); vox(room, 0x5a4030, [.3, .95, .3], [-21, 0, DZ + 2]);
  vox(room, 0xffffff, [.25, .3, .25], [-20.6, 1.1, DZ + 1.6]); vox(room, 0xf0ad4e, [.6, .1, .4], [-21.4, 1.1, DZ + 2.4]);
  for (const [x, z] of [[-22.7, DZ + 2], [-19.3, DZ + 2], [-21, DZ + 3.7], [-21, DZ + .3]]) {
    vox(room, 0xd9534f, [.8, .15, .8], [x, .35, z]); vox(room, 0x444444, [.15, .35, .15], [x, 0, z]);
  }
  // sofa by the front wall, vending machine, rug, plant
  vox(room, 0x2f6f8f, [4, .5, 1.3], [-24.4, 0, front - 1.4]);
  vox(room, 0x2f6f8f, [4, 1.2, .4], [-24.4, 0, front - .5]);
  vox(room, 0x27607c, [.4, .8, 1.3], [-26.6, 0, front - 1.4]); vox(room, 0x27607c, [.4, .8, 1.3], [-22.2, 0, front - 1.4]);
  vox(room, 0xd9534f, [1.4, 2.8, 1], [LX - 1.2, 0, front - 1]); vox(room, glass, [1, 1.6, .05], [LX - 1.3, 1, front - 1.52]);
  vox(room, 0xb0a48f, [4, .03, 4], [-21, 0, DZ + 2]);
  plant(PX + 1, front - 1, .9);
}

export function buildRoom() {
  seasonalEvents.dispose();
  room.clear();
  buildFloors();
  const W = buildWalls();
  buildEntrance(W);
  buildWindows(W);
  buildOfficeDecor(W);
  buildPods();
  buildMeetingCorner();
  buildLounge(W);
  buildLamps();
  buildPartition();
  buildPantry(W);
  seasonalEvents.rebuild({ parent: room, walls: W, bounds: { ...L }, camera, desks, visitor: visitorAgent });
  room.traverse(o => { if (o.isMesh && o.material === glass) o.castShadow = false; });
}
