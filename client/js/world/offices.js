// Offices other than the local one: a small annex per remote PC (each wired to a satellite dish), and one office
// floating on a cloud for claude.ai/code cloud sessions. Every office stands on its own spot far away from the
// others, beyond the camera's far plane even at full zoom-out (see core/engine.js), so you visit them one at a time.
// Remote employees always sit at their desks; there is no pantry out there.
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { vox } from '../core/voxel.js';
import { overlayElement, pin } from '../core/overlay.js';
import { CELL, DESKS_PER_POD, podDeskSlot } from './layout.js';
import { POD_RUG } from './palette.js';
import { makeSatelliteDish, animateDish, layCable } from './satellite-dish.js';

export const OFFICE_SPACING = 600; // > camera far plane + max zoom distance + office size
const DISH_SPACE = 11;
const ANNEX_WALL = 1.2;
const CLOUD_Y = 13, CLOUD_COLUMNS = 4, CLOUD_GAP_X = 7, CLOUD_GAP_Z = 7.5;

const offices = new Map(); // workspace id -> { id, kind, name, pods (annexes), bounds: { minX, maxX, minZ, maxZ, y }, view, sign, anchor }
let group = null, dishes = [], builtKey = '';

const podAt = (x, z) => ({ cx: x + CELL / 2, cz: z + CELL / 2, rot: 0, xL: x, xR: x + CELL, zT: z, zB: z + CELL });
const podCount = n => Math.max(1, Math.ceil(n / DESKS_PER_POD));

// ---------- building ----------
function podFurniture(pod, index) {
  const g = new THREE.Group(); g.position.set(pod.cx, 0, pod.cz); group.add(g);
  vox(g, 0x7a9a7e, [6.6, .7, .12], [0, 1.3, 0]); // divider between facing desks
  vox(g, POD_RUG[index % POD_RUG.length], [7.6, .03, 7.6], [0, 0, 0]);
}

function officeSign(office, x, y, z) {
  office.sign = overlayElement('zone', office.kind === 'cloud' ? '☁️ ' + office.name : '📡 ' + office.name);
  office.anchor = new THREE.Object3D(); office.anchor.position.set(x, y, z); group.add(office.anchor);
}

function buildAnnex(office) {
  const { minX, maxX, minZ, maxZ } = office.bounds, w = maxX - minX, d = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  vox(group, 0x8d9aa8, [w, .4, d], [cx, -.4, cz]); // carpet tiles
  const WALL = 0xd8d2c6;
  vox(group, WALL, [w + .4, ANNEX_WALL, .3], [cx, 0, minZ - .15]);
  vox(group, WALL, [.3, ANNEX_WALL, d], [minX - .15, 0, cz]);
  vox(group, WALL, [.3, ANNEX_WALL, d], [maxX + .15, 0, cz]);
  for (const [x0, x1] of [[minX, cx - 1.6], [cx + 1.6, maxX]]) vox(group, WALL, [x1 - x0, ANNEX_WALL, .3], [(x0 + x1) / 2, 0, maxZ + .15]); // doorway in front
  office.pods.forEach(podFurniture);
  // the dish stands east of the annex; the cable leaves through the east wall
  const dishX = maxX + DISH_SPACE / 2 + 1;
  dishes.push(makeSatelliteDish(group, dishX, cz - 2, 0));
  layCable(group, [maxX + .3, minZ + 2], [dishX, cz - 2 - 1.5]);
  officeSign(office, cx, ANNEX_WALL + 3.5, maxZ);
}

// Cloud sessions each float on their own cloud (see cloud-desk.js); the office is just where those clouds gather.
function cloudSeat(office, i) {
  const { minX, minZ } = office.bounds, col = i % CLOUD_COLUMNS, row = Math.floor(i / CLOUD_COLUMNS);
  const x = minX + CLOUD_GAP_X / 2 + col * CLOUD_GAP_X + (row % 2) * CLOUD_GAP_X / 3; // staggered rows
  const z = minZ + 2 + row * CLOUD_GAP_Z + Math.sin(i * 2.3) * .8;                   // a little scattered
  return {
    desk: { x, z }, deskRot: 0, y: office.bounds.y,
    seat: { pos: { x, z: z + 1.5 }, yaw: Math.PI, net: [] },
    visit: { pos: { x: x + 2.2, z: z + .5 }, yaw: -Math.PI / 2, net: [] },
  };
}

function buildCloudOffice(office) {
  const { minX, maxX, minZ } = office.bounds;
  officeSign(office, (minX + maxX) / 2, office.bounds.y + 5, minZ);
}

function clear() {
  for (const office of offices.values()) office.sign?.remove();
  if (group) scene.remove(group);
  group = new THREE.Group(); scene.add(group);
  dishes = [];
  offices.clear();
}

// ---------- arranging ----------
// workspaces: [{ workspace: { id, kind, name }, count }] for every non-local workspace with sessions.
// Rebuilds only when an office appears, disappears, grows or shrinks, or the main office moved.
// An office of `pods` pods in a grid `cols` wide, centered on (cx, cz).
function officeGrid(cx, cz, pods, cols) {
  const rows = Math.ceil(pods / cols), minX = cx - (cols * CELL + 2) / 2, minZ = cz - (rows * CELL + 2) / 2;
  const podList = Array.from({ length: pods }, (_, p) => podAt(minX + 1 + (p % cols) * CELL, minZ + 1 + Math.floor(p / cols) * CELL));
  return { pods: podList, bounds: { minX, maxX: minX + cols * CELL + 2, minZ, maxZ: minZ + rows * CELL + 2, y: 0 } };
}

// workspaces: [{ workspace: { id, kind, name }, count }] for every non-local workspace with sessions.
// Remote PCs line up east of the main office, the cloud sits north; each OFFICE_SPACING apart.
// Rebuilds only when an office appears, disappears, grows or shrinks.
export function arrangeOffices(workspaces) {
  const key = JSON.stringify(workspaces.map(w => [w.workspace.id, w.workspace.name, w.workspace.kind === 'cloud' ? w.count : podCount(w.count)]));
  if (key === builtKey) return;
  builtKey = key;
  clear();
  workspaces.filter(w => w.workspace.kind === 'remote').forEach(({ workspace, count }, k) => {
    const pods = podCount(count), { pods: podList, bounds } = officeGrid(OFFICE_SPACING * (k + 1), 0, pods, pods);
    const office = { ...workspace, pods: podList, bounds, view: { ...bounds, maxX: bounds.maxX + DISH_SPACE + 1 } }; // view includes the dish
    offices.set(workspace.id, office);
    buildAnnex(office);
  });
  const cloud = workspaces.find(w => w.workspace.kind === 'cloud');
  if (cloud) {
    const cols = Math.min(cloud.count, CLOUD_COLUMNS), rows = Math.ceil(cloud.count / CLOUD_COLUMNS);
    const width = (cols + .4) * CLOUD_GAP_X, depth = rows * CLOUD_GAP_Z + 2;
    const bounds = { minX: -width / 2, maxX: width / 2, minZ: -OFFICE_SPACING - depth / 2, maxZ: -OFFICE_SPACING + depth / 2, y: CLOUD_Y };
    const office = { ...cloud.workspace, bounds, view: bounds };
    offices.set(cloud.workspace.id, office);
    buildCloudOffice(office);
  }
}

// Desk placement for the i-th session of a workspace; y lifts cloud desks into the sky.
export function officeSlot(workspaceId, i) {
  const office = offices.get(workspaceId);
  if (office.kind === 'cloud') return cloudSeat(office, i);
  const slot = podDeskSlot(office.pods[Math.floor(i / DESKS_PER_POD)], i % DESKS_PER_POD);
  return { ...slot, y: office.bounds.y };
}

// the area to frame when zooming to an office
export const officeView = id => offices.get(id)?.view;
// the remote office closest to a point, or null when the point is nearer the main office (at the origin)
export function nearestOfficeView({ x, z }) {
  let best = null, bestDistance = Math.hypot(x, z);
  for (const { view } of offices.values()) {
    const distance = Math.hypot(x - (view.minX + view.maxX) / 2, z - (view.minZ + view.maxZ) / 2);
    if (distance < bestDistance) [best, bestDistance] = [view, distance];
  }
  return best;
}

export function stepOffices(now) {
  for (const dish of dishes) animateDish(dish, now);
  for (const office of offices.values()) pin(office.sign, office.anchor, 0);
}
