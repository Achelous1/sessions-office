// OpenRig links: flight-path arcs between desks, with a little voxel plane flying source -> target.
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { vox } from '../core/voxel.js';
import { desks } from './state.js';
import { CLAUDE_ORANGE } from './palette.js';

const ARC_HEIGHT = 3.1;
const links = new THREE.Group(); scene.add(links);
const linkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false });
let shownKey = '', flights = []; // { curve, plane, offset, duration }

function voxelPlane() {
  const g = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff }), wing = new THREE.MeshBasicMaterial({ color: CLAUDE_ORANGE });
  const parts = [[white, [.16, .16, .6], [0, 0, 0]], [wing, [.7, .04, .18], [0, 0, .04]], [wing, [.3, .04, .1], [0, 0, -.25]], [wing, [.04, .18, .1], [0, .08, -.25]]];
  for (const [mat, size, [x, y, z]] of parts) vox(g, mat, size, [x, y - size[1] / 2, z]).castShadow = false; // centered, not bottom-aligned
  return g;
}

// rig members are matched by session id, or by name when the id went stale
const deskOf = member => desks.get(member.id) ?? [...desks.values()].find(d => d.session.name === member.name);

function addFlight(from, to, i, total) {
  const start = new THREE.Vector3(from.x, ARC_HEIGHT, from.z), end = new THREE.Vector3(to.x, ARC_HEIGHT, to.z);
  const mid = start.clone().lerp(end, .5);
  mid.y += 3.5 + start.distanceTo(end) * .4; // longer hops fly higher
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .03, 6), linkMat);
  tube.castShadow = false; links.add(tube);
  for (const p of [start, end]) vox(links, linkMat, [.22, .22, .22], [p.x, p.y - .11, p.z]).castShadow = false;
  const plane = voxelPlane(); links.add(plane);
  flights.push({ curve, plane, offset: i / Math.max(1, total), duration: 2500 + curve.getLength() * 120 });
}

// Redraws the arcs only when the linked seats changed.
export function updateRigLinks(rigs) {
  const pairs = rigs.flatMap(r => r.edges.map(e => [deskOf(e.from), deskOf(e.to)])).filter(([a, b]) => a && b && a !== b);
  const seats = pairs.map(([a, b]) => [a.slot.seat.pos, b.slot.seat.pos]);
  const key = seats.map(ends => ends.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('>')).join('|');
  if (key === shownKey) return;
  shownKey = key;
  links.clear(); flights = [];
  seats.forEach(([from, to], i) => addFlight(from, to, i, seats.length));
}

export function flyPlanes(now) {
  for (const f of flights) {
    const t = (now / f.duration + f.offset) % 1, point = f.curve.getPoint(t);
    f.plane.position.copy(point);
    f.plane.lookAt(point.clone().add(f.curve.getTangent(t)));
  }
}
