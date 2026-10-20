// One desk + worker per live session: arriving, working or hanging out, and leaving.
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { vox, material } from '../core/voxel.js';
import { overlayElement, hiddenBubble, showBubble, pin } from '../core/overlay.js';
import { hangoutSpots } from './layout.js';
import { desks, clickables } from './state.js';
import { resolve, goTo, stepAgent } from './navigation.js';
import { updateLaptopScreen } from './laptop-screen.js';
import { CHAIR, HELD_ITEM, hash } from './palette.js';
import { person, pose, sip } from '../characters/person.js';
import { makeQuestionMark, updateQuestionMark } from '../characters/question-mark.js';
import { animateClawd } from '../characters/clawd.js';
import { cry } from '../characters/crying.js';

const ANSWER_BUBBLE_MS = 7000;
const LEAVE_SPEED = 4.5, CRYING_SPEED = 2.6;
const SITTING_ACTS = new Set(['sit', 'sofa', 'beanbag']);

const isAtWork = session => session.status === 'busy' || session.status === 'waiting' || !!session.rig; // rig members never leave their desk

// ---------- hangout spots ----------
const takenSpots = new Map(); // spot index -> desk id

function claimSpot(desk) {
  const count = hangoutSpots().length;
  for (let k = 0; k < count; k++) {
    const i = (hash(desk.id) + k) % count;
    if (!takenSpots.has(i)) { takenSpots.set(i, desk.id); return { kind: 'spot', i }; }
  }
  return { kind: 'spot', i: hash(desk.id) % count }; // more idle sessions than spots: share one
}

function releaseSpot(desk) {
  for (const [i, id] of takenSpots) if (id === desk.id) takenSpots.delete(i);
}

// ---------- building ----------
const markClickable = (obj, id) => obj.traverse(o => { if (o.isMesh) { o.userData.sid = id; clickables.push(o); } });
function forgetClickables(predicate) {
  for (let i = clickables.length - 1; i >= 0; i--) if (predicate(clickables[i])) clickables.splice(i, 1);
}

// desk with a laptop and a mug; the chair is on local +z
function buildDesk(sessionId) {
  const g = new THREE.Group(); scene.add(g);
  vox(g, 0xa0764a, [3.2, .2, 1.6], [0, 1.1, 0]);
  for (const [x, z] of [[-1.4, -.6], [1.4, -.6], [-1.4, .6], [1.4, .6]]) vox(g, 0x5a4030, [.2, 1.1, .2], [x, 0, z]);
  vox(g, 0x5a4030, [3, .7, .1], [0, .4, -.7]); // modesty panel
  vox(g, 0x3a3a3a, [1.2, .08, .8], [0, 1.3, .1]);
  const lid = new THREE.Group(); lid.position.set(0, 1.38, -.3); lid.rotation.x = -.25; g.add(lid);
  vox(lid, 0x3a3a3a, [1.2, .8, .06], [0, 0, 0]);
  const screen = vox(lid, new THREE.MeshBasicMaterial({ color: 0x111111 }), [1.05, .65, .02], [0, .07, .04]);
  vox(g, 0xffffff, [.25, .3, .25], [1.1, 1.3, .3]); // mug
  const chair = CHAIR[hash(sessionId) % CHAIR.length];
  vox(g, chair, [1, .2, 1], [0, .3, 1.6]); vox(g, chair, [1, 1.1, .2], [0, .5, 2.1]); vox(g, 0x555555, [.2, .3, .2], [0, 0, 1.6]);
  return { group: g, screen };
}

// A new session walks in from the door; ones already running on page load start in place.
export function createDesk(session, slot, walkInFromDoor) {
  const { group, screen } = buildDesk(session.id);
  markClickable(group, session.id);
  const obj = person(session.id); scene.add(obj); markClickable(obj, session.id);
  const worker = { obj, loc: { kind: 'entry' }, path: [], phase: hash(session.id) % 1000 };
  const desk = {
    id: session.id, session, slot, group, screen, worker,
    questionMark: makeQuestionMark(), clawds: [],
    label: overlayElement('label'), bubble: hiddenBubble('bubble a'), bubbleUntil: 0,
    turns: session.turns, answerTs: session.lastAnswer?.ts,
  };
  desks.set(session.id, desk);
  if (!walkInFromDoor) worker.loc = isAtWork(session) ? { kind: 'seat', d: session.id } : claimSpot(desk);
  return desk;
}

export function placeDesk(desk, slot) {
  desk.slot = slot;
  desk.group.position.set(slot.desk.x, 0, slot.desk.z);
  desk.group.rotation.y = slot.deskRot;
}

export function sayAnswer(desk, text, now = performance.now()) {
  showBubble(desk.bubble, text);
  desk.bubbleUntil = now + ANSWER_BUBBLE_MS;
}

// ---------- leaving ----------
// A closed session clears its desk at once and walks out; a fired one cries on the way.
export function sendHome(desk, crying) {
  desk.leaving = { crying };
  const deskMeshes = new Set(); desk.group.traverse(o => deskMeshes.add(o));
  forgetClickables(mesh => deskMeshes.has(mesh));
  scene.remove(desk.group);
  releaseSpot(desk);
  desk.questionMark.visible = false;
  desk.worker.speed = crying ? CRYING_SPEED : LEAVE_SPEED;
  goTo(desk.worker, { kind: 'exit' });
  if (crying) { showBubble(desk.bubble, 'ㅠㅠ 그동안 감사했습니다…'); desk.bubbleUntil = Infinity; }
}

function removeDesk(desk) {
  scene.remove(desk.questionMark, desk.group, desk.worker.obj);
  desk.label.remove(); desk.bubble.remove();
  releaseSpot(desk);
  desks.delete(desk.id);
  forgetClickables(mesh => mesh.userData.sid === desk.id);
}

// ---------- per frame ----------
function chooseDestination(desk) {
  const worker = desk.worker, want = isAtWork(desk.session) ? 'seat' : 'spot';
  if (worker.loc.kind === want) return;
  releaseSpot(desk);
  goTo(worker, want === 'seat' ? { kind: 'seat', d: desk.id } : claimSpot(desk));
}

function animateActivity(worker, act, typing, now) {
  const u = worker.obj.userData;
  if (typing) {
    u.arms[0].rotation.x = -1.3 + Math.sin(now / 70 + worker.phase) * .15;
    u.arms[1].rotation.x = -1.3 + Math.sin(now / 70 + worker.phase + 1.7) * .15;
  } else if (act === 'snack') sip(worker.obj, now, 1600, worker.phase);
  else if (act === 'pingpong') { // paddle swings side to side
    const t = Math.sin(now / 260 + worker.phase);
    u.arms[1].rotation.set(-1.1, 0, t * .9);
    worker.obj.position.y = Math.abs(t) * .06;
  } else if (act === 'fridge') u.arms[1].rotation.x = -1.4 + Math.sin(now / 400) * .2;
  else if (act === 'chat') {
    u.head.rotation.y = Math.sin(now / 700 + worker.phase) * .4;
    u.arms[0].rotation.x = -.6 + Math.sin(now / 250 + worker.phase) * .4;
  } else if (act) sip(worker.obj, now, 4200, worker.phase);
}

function stepWorker(desk, dt, now) {
  const worker = desk.worker, u = worker.obj.userData;
  if (desk.leaving) { // walk out the door, then gone for good
    if (!stepAgent(worker, dt, now)) return removeDesk(desk);
    if (desk.leaving.crying) cry(worker.obj, now);
    return;
  }
  if (!worker.path.length) chooseDestination(desk);
  if (stepAgent(worker, dt, now)) { u.item.visible = false; return; }
  const seated = worker.loc.kind === 'seat';
  const act = worker.loc.kind === 'spot' ? resolve(worker.loc).act : null;
  pose(worker.obj, seated || SITTING_ACTS.has(act) ? 'sit' : 'stand', now);
  u.item.visible = !!HELD_ITEM[act];
  if (HELD_ITEM[act]) u.item.material = material(HELD_ITEM[act]);
  animateActivity(worker, act, seated && desk.session.status === 'busy', now);
  if (desk.bubbleUntil > now) u.head.rotation.y = Math.sin(now / 200) * .3; // talking
}

export function stepDesks(dt, now) {
  for (const desk of desks.values()) {
    updateLaptopScreen(desk, now);
    stepWorker(desk, dt, now);
    if (desk.bubbleUntil <= now) desk.bubble.style.opacity = 0;
    pin(desk.label, desk.worker.obj, 3.4);
    pin(desk.bubble, desk.worker.obj, 4.3);
    desk.clawds.forEach(clawd => animateClawd(clawd, now));
    updateQuestionMark(desk.questionMark, desk.worker.obj, !desk.leaving && desk.session.status === 'waiting', now);
  }
}
