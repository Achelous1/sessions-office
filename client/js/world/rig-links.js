// OpenRig links: flight-path arcs between workers' heads, with a little voxel plane flying source -> target.
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { vox } from '../core/voxel.js';
import { desks } from './state.js';
import { CLAUDE_ORANGE } from './palette.js';

const ABOVE_HEAD = 3.4; // from a worker's feet; same height the name label hangs at
const REBUILD_DISTANCE = .05; // re-trace an arc only once an end has moved this far
const links = new THREE.Group(); scene.add(links);
const linkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false });
let shownKey = '', flights = []; // { from, to, curve, tube, ends, plane, offset }

function voxelPlane() {
  const g = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xffffff }), wing = new THREE.MeshBasicMaterial({ color: CLAUDE_ORANGE });
  const parts = [[white, [.16, .16, .6], [0, 0, 0]], [wing, [.7, .04, .18], [0, 0, .04]], [wing, [.3, .04, .1], [0, 0, -.25]], [wing, [.04, .18, .1], [0, .08, -.25]]];
  for (const [mat, size, [x, y, z]] of parts) vox(g, mat, size, [x, y - size[1] / 2, z]).castShadow = false; // centered, not bottom-aligned
  return g;
}

// rig members are matched by session id, or by name when the id went stale
const deskOf = member => desks.get(member.id) ?? desks.get('codex-' + member.id)
  ?? [...desks.values()].find(d => d.session.name === member.name);

const headOf = desk => desk.worker.obj.position.clone().setY(desk.worker.obj.position.y + ABOVE_HEAD);

function addFlight(from, to, i, total) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const tube = new THREE.Mesh(new THREE.BufferGeometry(), linkMat); tube.castShadow = false; links.add(tube);
  const ends = [0, 1].map(() => { const end = vox(links, linkMat, [.22, .22, .22], [0, 0, 0]); end.castShadow = false; return end; });
  const plane = voxelPlane(); links.add(plane);
  flights.push({ from, to, curve, tube, ends, plane, offset: i / Math.max(1, total) });
}

// The arc hangs between the two heads, so it follows a worker who walks off for a break.
function traceArc(f) {
  const start = headOf(f.from), end = headOf(f.to);
  if (start.distanceTo(f.curve.v0) < REBUILD_DISTANCE && end.distanceTo(f.curve.v2) < REBUILD_DISTANCE) return;
  f.curve.v0.copy(start); f.curve.v2.copy(end);
  f.curve.v1.copy(start).lerp(end, .5).y += 3.5 + start.distanceTo(end) * .4; // longer hops fly higher
  f.curve.updateArcLengths(); // the curve caches its lengths
  f.tube.geometry.dispose();
  f.tube.geometry = new THREE.TubeGeometry(f.curve, 48, .03, 6);
  f.ends.forEach((box, k) => box.position.copy(k ? end : start));
  f.duration = 2500 + f.curve.getLength() * 120;
}

// Redraws the arcs only when the linked desks changed.
export function updateRigLinks(rigs) {
  const pairs = rigs.flatMap(r => r.edges.map(e => [deskOf(e.from), deskOf(e.to)])).filter(([a, b]) => a && b && a !== b);
  const key = pairs.map(([a, b]) => `${a.id}>${b.id}`).join('|');
  if (key === shownKey) return;
  shownKey = key;
  for (const f of flights) f.tube.geometry.dispose();
  links.clear(); flights = [];
  pairs.forEach(([from, to], i) => addFlight(from, to, i, pairs.length));
}

export function flyPlanes(now) {
  for (const f of flights) {
    traceArc(f);
    const t = (now / f.duration + f.offset) % 1, point = f.curve.getPoint(t);
    f.plane.position.copy(point);
    f.plane.lookAt(point.clone().add(f.curve.getTangent(t)));
  }
}
