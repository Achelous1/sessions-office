// Polls the server and brings the office in line with the live sessions.
import { fetchSessions, fetchRigs } from './api.js';
import { clip } from './core/overlay.js';
import { layout, deskSlot } from './world/layout.js';
import { buildRoom } from './world/room.js';
import { desks, firedIds } from './world/state.js';
import { createDesk, placeDesk, sayAnswer, sendHome } from './world/desks.js';
import { queueVisit, placeVisitorAtHome } from './world/visitor.js';
import { updateRigLinks } from './world/rig-links.js';
import { syncClawds } from './characters/clawd.js';
import { refreshChat } from './ui/chat-panel.js';
import { renderStaff } from './ui/staff-drawer.js';
import { HOST_ICON } from './ui/labels.js';

const POLL_MS = 2000;
const LABEL_LENGTH = 32;
let firstPoll = true;

// OpenRig members are tagged and seated together (rig members first, in rig order) so a team shares pods.
function tagRigMembers(sessions, rigs) {
  for (const s of sessions) for (const rig of rigs) {
    const k = rig.members.findIndex(m => m.id === s.id || m.name === s.name);
    if (k >= 0) { s.rig = { name: rig.name, k, logicalId: rig.members[k].logicalId }; break; }
  }
  sessions.sort((a, b) => !a.rig - !b.rig || (a.rig && b.rig ? a.rig.name.localeCompare(b.rig.name) || a.rig.k - b.rig.k : 0));
}

function updateHeadcount(sessions) {
  const busy = sessions.filter(s => s.status === 'busy').length, waiting = sessions.filter(s => s.status === 'waiting').length;
  document.getElementById('count').textContent =
    `세션 ${sessions.length}개 · 작업 중 ${busy}개 · 답변 대기 ${waiting}개 · 휴식 ${sessions.length - busy - waiting}명 · 클릭하면 대화 내역`;
}

function syncDesk(s, i) {
  const desk = desks.get(s.id) ?? createDesk(s, deskSlot(i), !firstPoll);
  placeDesk(desk, deskSlot(i));
  if (s.turns > desk.turns && s.lastUser) queueVisit(desk.id, s.lastUser.text); // someone asked this session
  if (s.lastAnswer && s.lastAnswer.ts !== desk.answerTs) sayAnswer(desk, s.lastAnswer.text); // it answered
  desk.turns = s.turns; desk.answerTs = s.lastAnswer?.ts; desk.session = s;
  syncClawds(desk, s.subagents?.length ?? 0);
  desk.label.textContent = (HOST_ICON[s.host] ?? '') + clip(s.title || s.name, LABEL_LENGTH);
  desk.label.className = 'label' + (s.status === 'busy' ? ' busy' : '');
}

export async function poll() {
  let sessions, rigs;
  try { [sessions, rigs] = await Promise.all([fetchSessions(), fetchRigs()]); } catch { return; }
  tagRigMembers(sessions, rigs);
  updateHeadcount(sessions);
  if (layout(sessions.length)) buildRoom();
  const liveIds = new Set(sessions.map(s => s.id));
  for (const desk of [...desks.values()]) if (!liveIds.has(desk.id) && !desk.leaving) sendHome(desk, firedIds.has(desk.id));
  sessions.forEach(syncDesk);
  updateRigLinks(rigs);
  if (firstPoll) placeVisitorAtHome();
  firstPoll = false;
  refreshChat();
  renderStaff(sessions);
}

export function startPolling() {
  setInterval(poll, POLL_MS);
  poll();
}
