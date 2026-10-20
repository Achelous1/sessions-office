// Office floor plan. 4-desk pods sit in an 11x11 grid of cells, two cells per row; walkways run along the cell
// edges (vertical ones at WALKWAY_X, horizontal ones at L.HZ). The pantry lies west of the glass partition (L.LX),
// the lounge east of the last walkway (x > 8). Rows are added as sessions arrive, so L changes with the head count.
export const CELL = 11;
export const WALKWAY_X = [-14, -3, 8];
const DESKS_PER_POD = 4, PODS_PER_ROW = 2;

// LC: pantry door walkway, LX: glass partition, PX: west wall, RX: east wall; the rest is filled in by layout()
export const L = { LC: -14, LX: -15.5, PX: -27, RX: 16 };

// Sizes the office for n sessions. Returns true when the room has to be rebuilt.
export function layout(sessionCount) {
  const pods = Math.max(1, Math.ceil(sessionCount / DESKS_PER_POD)), rows = Math.ceil(pods / PODS_PER_ROW);
  if (pods === L.pods) return false;
  L.pods = pods;
  const top = -rows * CELL / 2;
  L.HZ = Array.from({ length: rows + 1 }, (_, k) => top + k * CELL);
  L.back = top - 1.5;
  L.front = L.HZ.at(-1) + 1.5;
  L.DZ = (L.back + L.front) / 2; // pantry door
  L.EZ = L.HZ.at(-1);            // entrance door
  return true;
}

export function podOf(index) {
  const row = Math.floor(index / PODS_PER_ROW), col = index % PODS_PER_ROW;
  return {
    cx: WALKWAY_X[col] + CELL / 2, cz: L.HZ[row] + CELL / 2, rot: (row + col) % 2 ? Math.PI / 2 : 0, // checkerboard
    xL: WALKWAY_X[col], xR: WALKWAY_X[col + 1], zT: L.HZ[row], zB: L.HZ[row + 1],
  };
}

// pod-local (x, z) -> world, same convention as Object3D.rotation.y
const toWorld = (pod, x, z) => ({
  x: pod.cx + x * Math.cos(pod.rot) + z * Math.sin(pod.rot),
  z: pod.cz - x * Math.sin(pod.rot) + z * Math.cos(pod.rot),
});

// walk from p along an axis-aligned direction until the cell edge (a walkway)
const toWalkway = (pod, p, dir) => Math.abs(dir.x) > .5
  ? { x: dir.x > 0 ? pod.xR : pod.xL, z: p.z, t: 'v' }
  : { x: p.x, z: dir.z > 0 ? pod.zB : pod.zT, t: 'h' };

// Desk placement for the i-th session, with the routes from its seat (and the visitor's standing spot) to a walkway.
export function deskSlot(i) {
  const pod = podOf(Math.floor(i / DESKS_PER_POD)), k = i % DESKS_PER_POD;
  const sideX = k % 2 ? 1.65 : -1.65, facing = k < 2 ? -1 : 1;
  const direction = (x, z) => toWorld({ ...pod, cx: 0, cz: 0 }, x, z);
  const outward = direction(0, facing), sideways = direction(Math.sign(sideX), 0);
  const aisle = toWorld(pod, sideX, facing * 3.6), visitorStand = toWorld(pod, sideX + Math.sign(sideX) * 2.2, facing * 1.9);
  return {
    desk: toWorld(pod, sideX, facing * .8), deskRot: pod.rot + (facing > 0 ? 0 : Math.PI),
    seat: { pos: toWorld(pod, sideX, facing * 2.3), yaw: Math.atan2(-outward.x, -outward.z), net: [aisle, toWalkway(pod, aisle, outward)] },
    visit: { pos: visitorStand, yaw: Math.atan2(-sideways.x, -sideways.z), net: [toWalkway(pod, visitorStand, sideways)] },
  };
}

// Hangout spots for idle sessions: pantry first, then the lounge. `act` picks the pose and the held item.
export function hangoutSpots() {
  const B = L.back, pantryNet = [{ x: L.LX - 1.5, z: L.DZ }, { x: L.LC, z: L.DZ, t: 'v' }];
  const lounge = [{ x: 8, z: B + 6.5, t: 'v' }], faceTable = (x, z) => Math.atan2(12.3 - x, B + 4.6 - z);
  const pantry = [
    { x: L.PX + 2.3, z: B + 3, yaw: -Math.PI / 2, act: 'water' },
    { x: -24, z: B + 2.3, yaw: Math.PI, act: 'coffee' },
    { x: -21, z: B + 2.3, yaw: Math.PI, act: 'snack' },
    { x: -18.5, z: B + 2.3, yaw: Math.PI, act: 'snack' },
    { x: L.PX + 2.4, z: B + 6.5, yaw: -Math.PI / 2, act: 'fridge' },
    { x: -22.7, z: L.DZ + 2, yaw: Math.PI / 2, act: 'sit' },
    { x: -19.3, z: L.DZ + 2, yaw: -Math.PI / 2, act: 'sit' },
    { x: -21, z: L.DZ + 3.7, yaw: Math.PI, act: 'sit' },
    { x: -21, z: L.DZ + .3, yaw: 0, act: 'sit' },
    { x: -25.3, z: L.front - 1.9, yaw: Math.PI, act: 'sofa' },
    { x: -23.6, z: L.front - 1.9, yaw: Math.PI, act: 'sofa' },
    { x: -17.5, z: L.DZ - 2.5, yaw: -2.2, act: 'chat' },
    { x: -18.8, z: L.DZ - 3.6, yaw: 1, act: 'chat' },
  ].map(s => ({ ...s, net: pantryNet }));
  return pantry.concat([
    { x: 9.4, z: B + 8.5, yaw: Math.PI / 2, act: 'pingpong', net: [{ x: 8, z: B + 8.5, t: 'v' }] },
    { x: 14.6, z: B + 8.5, yaw: -Math.PI / 2, act: 'pingpong', net: [{ x: 14.6, z: B + 6.5 }, ...lounge] },
    { x: 10, z: B + 3, yaw: faceTable(10, B + 3), act: 'beanbag', net: [{ x: 10, z: B + 6.5 }, ...lounge] },
    { x: 12.6, z: B + 2.5, yaw: faceTable(12.6, B + 2.5), act: 'beanbag', net: [{ x: 12.6, z: B + 6.5 }, ...lounge] },
    { x: 14.6, z: B + 3.6, yaw: faceTable(14.6, B + 3.6), act: 'beanbag', net: [{ x: 14.6, z: B + 6.5 }, ...lounge] },
  ]);
}
