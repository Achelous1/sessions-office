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
const CLOUD_Y = 13, CLOUD_PODS_PER_ROW = 2;

// lit a little from within, so the shaded sides stay white instead of turning grey
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a93a3 });

const offices = new Map(); // workspace id -> { id, kind, name, pods, bounds: { minX, maxX, minZ, maxZ, y }, view, sign, anchor }
let group = null, dishes = [], builtKey = '';

const podAt = (x, z) => ({ cx: x + CELL / 2, cz: z + CELL / 2, rot: 0, xL: x, xR: x + CELL, zT: z, zB: z + CELL });
const podCount = n => Math.max(1, Math.ceil(n / DESKS_PER_POD));

// ---------- building ----------
function podFurniture(pod, y, index) {
  const g = new THREE.Group(); g.position.set(pod.cx, y, pod.cz); group.add(g);
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
  office.pods.forEach((pod, i) => podFurniture(pod, 0, i));
  // the dish stands east of the annex; the cable leaves through the east wall
  const dishX = maxX + DISH_SPACE / 2 + 1;
  dishes.push(makeSatelliteDish(group, dishX, cz - 2, 0));
  layCable(group, [maxX + .3, minZ + 2], [dishX, cz - 2 - 1.5]);
  officeSign(office, cx, ANNEX_WALL + 3.5, maxZ);
}

// a puff is a small stack of boxes, wide at the bottom and rounder on top
function puff(x, y, z, size) {
  vox(group, cloudMat, [size, size * .45, size * .8], [x, y, z]);
  vox(group, cloudMat, [size * .8, size * .45, size], [x, y, z]);
  vox(group, cloudMat, [size * .6, size * .35, size * .6], [x, y + size * .45, z]);
}

// a white floor slab on a bed of cloud puffs, with a fluffy rim poking up around the edge
function buildCloud(office) {
  const { minX, maxX, minZ, maxZ, y } = office.bounds, w = maxX - minX, d = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, floorTop = y, below = y - .4;
  vox(group, 0xf7faff, [w, .4, d], [cx, below, cz]);
  const lump = (x, z) => Math.sin(x * 1.7 + z * .9) * .5 + .5; // deterministic, so rebuilds look the same
  for (let x = minX + 1.5; x < maxX; x += 3.2) for (let z = minZ + 1.5; z < maxZ; z += 3.2) {
    const s = 3.2 + lump(x, z) * 1.6;
    puff(x, below - s * .8, z, s); // underneath: tops stay below the floor
  }
  const rim = (x, z) => puff(x, floorTop - .9 - lump(x, z) * .4, z, 2 + lump(z, x) * 1.2);
  for (let x = minX; x <= maxX; x += 2.2) { rim(x, minZ - .6); rim(x, maxZ + .6); }
  for (let z = minZ + 2; z < maxZ - 1; z += 2.2) { rim(minX - .6, z); rim(maxX + .6, z); }
  office.pods.forEach((pod, i) => podFurniture(pod, y, i));
  officeSign(office, cx, y + 4.5, maxZ);
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
function officeGrid(cx, cz, y, pods, cols) {
  const rows = Math.ceil(pods / cols), minX = cx - (cols * CELL + 2) / 2, minZ = cz - (rows * CELL + 2) / 2;
  const podList = Array.from({ length: pods }, (_, p) => podAt(minX + 1 + (p % cols) * CELL, minZ + 1 + Math.floor(p / cols) * CELL));
  return { pods: podList, bounds: { minX, maxX: minX + cols * CELL + 2, minZ, maxZ: minZ + rows * CELL + 2, y } };
}

// workspaces: [{ workspace: { id, kind, name }, count }] for every non-local workspace with sessions.
// Remote PCs line up east of the main office, the cloud sits north; each OFFICE_SPACING apart.
// Rebuilds only when an office appears, disappears, grows or shrinks.
export function arrangeOffices(workspaces) {
  const key = JSON.stringify(workspaces.map(w => [w.workspace.id, w.workspace.name, podCount(w.count)]));
  if (key === builtKey) return;
  builtKey = key;
  clear();
  workspaces.filter(w => w.workspace.kind === 'remote').forEach(({ workspace, count }, k) => {
    const pods = podCount(count), { pods: podList, bounds } = officeGrid(OFFICE_SPACING * (k + 1), 0, 0, pods, pods);
    const office = { ...workspace, pods: podList, bounds, view: { ...bounds, maxX: bounds.maxX + DISH_SPACE + 1 } }; // view includes the dish
    offices.set(workspace.id, office);
    buildAnnex(office);
  });
  const cloud = workspaces.find(w => w.workspace.kind === 'cloud');
  if (cloud) {
    const pods = podCount(cloud.count), { pods: podList, bounds } = officeGrid(0, -OFFICE_SPACING, CLOUD_Y, pods, Math.min(pods, CLOUD_PODS_PER_ROW));
    const office = { ...cloud.workspace, pods: podList, bounds, view: bounds };
    offices.set(cloud.workspace.id, office);
    buildCloud(office);
  }
}

// Desk placement for the i-th session of a workspace; y lifts it onto the cloud.
export function officeSlot(workspaceId, i) {
  const office = offices.get(workspaceId);
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
