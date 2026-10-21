// Walking. Every route runs along the walkway grid (cell edges), so nobody walks through furniture.
// A location ("loc") is { kind: 'seat' | 'visit', d: deskId } | { kind: 'spot', i } | { kind: 'home' | 'exit' | 'entry' };
// it resolves to a position, a facing (yaw) and a short path ("net") from there to the nearest walkway.
// Waypoints tagged t:'h' sit on a horizontal walkway (z in L.HZ), t:'v' on a vertical one (x in WALKWAY_X).
import { L, WALKWAY_X, hangoutSpots } from './layout.js';
import { desks } from './state.js';
import { pose } from '../characters/person.js';

const WALK_SPEED = 4.5;
const ARRIVED = .05, SAME_LINE = .01;

// the walkway line between a and b that makes the shortest detour
const nearestLine = (lines, a, b) => lines.reduce((best, c) => Math.abs(a - c) + Math.abs(b - c) < Math.abs(a - best) + Math.abs(b - best) ? c : best);

function connect(a, b) {
  if (a.t === 'h' && b.t === 'h') {
    if (Math.abs(a.z - b.z) < SAME_LINE) return [b];
    const x = nearestLine(WALKWAY_X, a.x, b.x);
    return [{ x, z: a.z }, { x, z: b.z }, b];
  }
  if (a.t === 'v' && b.t === 'v') {
    if (Math.abs(a.x - b.x) < SAME_LINE) return [b];
    const z = nearestLine(L.HZ, a.z, b.z);
    return [{ x: a.x, z }, { x: b.x, z }, b];
  }
  return a.t === 'h' ? [{ x: b.x, z: a.z }, b] : [{ x: a.x, z: b.z }, b];
}

export function resolve(loc) {
  const desk = loc.d && desks.get(loc.d);
  if (desk && (loc.kind === 'seat' || loc.kind === 'visit')) return desk.slot[loc.kind];
  if (loc.kind === 'spot') { const s = hangoutSpots()[loc.i]; return { pos: s, yaw: s.yaw, act: s.act, net: s.net }; }
  if (loc.kind === 'home') return { pos: { x: -1.5, z: L.back + 2.2 }, yaw: Math.PI, net: [{ x: -1.5, z: L.HZ[0], t: 'h' }] }; // the visitor, at the whiteboard
  if (loc.kind === 'exit') return { pos: { x: L.RX + 3, z: L.EZ }, yaw: Math.PI / 2, net: [{ x: 15, z: L.EZ, t: 'h' }] }; // out the door
  return { pos: { x: 15, z: L.EZ, t: 'h' }, yaw: -Math.PI / 2, net: [] }; // entry (also the fallback for vanished desks)
}

function route(from, to) {
  const f = resolve(from), t = resolve(to);
  const a = f.net.at(-1) ?? f.pos, b = t.net.at(-1) ?? t.pos;
  return [...f.net, ...connect(a, b), ...[...t.net].reverse().slice(1), t.pos];
}

// An agent is { obj, loc, path, phase, speed? } plus `from` / `full` (the route it is walking).
export function goTo(agent, loc) {
  agent.from = agent.loc;
  agent.path = route(agent.loc, loc);
  agent.full = [...agent.path];
  agent.loc = loc;
}

// Change destination mid-walk without leaving the walkways: both routes start at the same origin, so keep going
// while they agree, otherwise walk back to the last shared waypoint and branch off there.
export function redirect(agent, loc) {
  if (!agent.path.length || !agent.full) return goTo(agent, loc);
  const walking = agent.full, next = route(agent.from, loc);
  const reached = walking.length - agent.path.length;
  let shared = 0;
  while (shared < walking.length && shared < next.length &&
         Math.abs(walking[shared].x - next[shared].x) + Math.abs(walking[shared].z - next[shared].z) < SAME_LINE) shared++;
  agent.path = reached <= shared ? next.slice(reached) : [...walking.slice(Math.max(shared - 1, 0), reached).reverse(), ...next.slice(shared)];
  agent.full = reached <= shared ? next : null; // after a walk-back the origin no longer lines up; the next change just waits
  agent.loc = loc;
}

// Moves the agent along its path. Returns true while walking.
export function stepAgent(agent, dt, now) {
  const obj = agent.obj, pos = obj.position;
  while (agent.path.length) {
    const p = agent.path[0], dx = p.x - pos.x, dz = p.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist < ARRIVED) { agent.path.shift(); continue; }
    const step = Math.min(dist, dt * (agent.speed ?? WALK_SPEED));
    pos.x += dx / dist * step; pos.z += dz / dist * step;
    obj.rotation.y = Math.atan2(dx, dz);
    pose(obj, 'walk', now, agent.phase);
    return true;
  }
  const parked = resolve(agent.loc); // stick to the anchor even if desks re-layout
  pos.x = parked.pos.x; pos.z = parked.pos.z; obj.rotation.y = parked.yaw;
  return false;
}
