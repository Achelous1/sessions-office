// The visitor (you): writes on the whiteboard, and walks over to ask a session whenever it gets a new prompt.
import { scene } from '../core/engine.js';
import { hiddenBubble, showBubble, pin } from '../core/overlay.js';
import { L } from './layout.js';
import { desks } from './state.js';
import { resolve, goTo, redirect, stepAgent } from './navigation.js';
import { VISITOR_SHIRT } from './palette.js';
import { person, pose } from '../characters/person.js';

const ASK_MS = 3500, WAIT_FOR_ANSWER_MS = 2500;

const visitor = { obj: person('visitor', VISITOR_SHIRT), loc: { kind: 'home' }, path: [], phase: 0 };
scene.add(visitor.obj);
const bubble = hiddenBubble('bubble q');

const queue = []; // { id, question } — sessions to visit, in order
let trip = null;  // { id, question, phase: 'go' | 'ask' | 'wait', since }

export function queueVisit(deskId, question) {
  if (!queue.some(job => job.id === deskId)) queue.push({ id: deskId, question });
}

export function placeVisitorAtHome() {
  const home = resolve({ kind: 'home' }).pos;
  visitor.obj.position.set(home.x, 0, home.z);
}

function endTrip() {
  trip = null;
  if (!queue.length) goTo(visitor, { kind: 'home' }); // another question waiting? go straight there
}

function startNextTrip() {
  const job = queue.shift();
  if (!desks.has(job.id)) return;
  trip = { ...job, phase: 'go' };
  redirect(visitor, { kind: 'visit', d: job.id });
}

function writeOnWhiteboard(now) {
  visitor.obj.userData.arms[1].rotation.set(-2.1 + Math.sin(now / 260) * .15, 0, Math.sin(now / 170) * .2);
}

// go -> ask (speech bubble) -> wait for the answer bubble or a timeout
function advanceTrip(now) {
  const desk = desks.get(trip.id);
  if (!desk) return endTrip();
  if (trip.phase === 'go') {
    Object.assign(trip, { phase: 'ask', since: now });
    showBubble(bubble, trip.question);
  } else if (trip.phase === 'ask' && now - trip.since > ASK_MS) {
    bubble.style.opacity = 0;
    Object.assign(trip, { phase: 'wait', since: now });
  } else if (trip.phase === 'wait' && (now - trip.since > WAIT_FOR_ANSWER_MS || desk.bubbleUntil > now)) {
    return endTrip();
  }
  if (trip.phase === 'ask') visitor.obj.userData.arms[1].rotation.x = -1 + Math.sin(now / 200) * .3; // gesturing
}

export function stepVisitor(dt, now) {
  if (!L.HZ) return; // the layout arrives with the first poll
  const free = !visitor.path.length || visitor.loc.kind === 'home'; // also while heading back to the board
  if (!trip && queue.length && free) startNextTrip();
  if (!stepAgent(visitor, dt, now)) {
    pose(visitor.obj, 'stand', now);
    if (trip) advanceTrip(now);
    else writeOnWhiteboard(now);
  }
  pin(bubble, visitor.obj, visitor.obj.userData.witchHat ? 4.6 : 3.6);
}

export const visitorAgent = visitor; // for the #debug hook
