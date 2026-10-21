// Polls the server and brings the office in line with the live sessions.
import { fetchSessions, fetchRigs, fetchRemoteStatus } from './api.js';
import { clip } from './core/overlay.js';
import { layout, deskSlot } from './world/layout.js';
import { buildRoom } from './world/room.js';
import { arrangeOffices, officeSlot } from './world/offices.js';
import { desks, firedIds } from './world/state.js';
import { createDesk, placeDesk, sayAnswer, sendHome } from './world/desks.js';
import { queueVisit, placeVisitorAtHome } from './world/visitor.js';
import { updateRigLinks } from './world/rig-links.js';
import { syncClawds } from './characters/clawd.js';
import { refreshChat } from './ui/chat-panel.js';
import { renderStaff } from './ui/staff-drawer.js';
import { renderOffices } from './ui/offices-tab.js';
import { agentEnvironment } from './ui/labels.js';

const POLL_MS = 2000;
const LABEL_LENGTH = 32;
let firstPoll = true;

// OpenRig members are tagged and seated together (rig members first, in rig order) so a team shares pods.
function tagRigMembers(sessions, rigs) {
  for (const s of sessions) for (const rig of rigs) {
    const k = rig.members.findIndex(m => m.id === (s.sessionId || s.id) || m.name === s.name);
    if (k >= 0) { s.rig = { name: rig.name, k, logicalId: rig.members[k].logicalId }; break; }
  }
  sessions.sort((a, b) => !a.rig - !b.rig || (a.rig && b.rig ? a.rig.name.localeCompare(b.rig.name) || a.rig.k - b.rig.k : 0));
}

function updateHeadcount(sessions) {
  const busy = sessions.filter(s => s.status === 'busy').length, waiting = sessions.filter(s => s.status === 'waiting').length;
  const unknown = sessions.filter(s => s.status === 'unknown').length;
  document.getElementById('count').textContent =
    `세션 ${sessions.length}개 · 작업 중 ${busy}개 · 답변 대기 ${waiting}개 · 휴식 ${sessions.length - busy - waiting - unknown}명` +
    (unknown ? ` · 상태 미확인 ${unknown}개` : '') + ' · 클릭하면 대화 내역';
}

// Local sessions fill the main office in order; every other workspace gets its own office.
function groupByWorkspace(sessions) {
  const local = [], others = new Map();
  for (const s of sessions) {
    if ((s.workspace?.kind ?? 'local') === 'local') { local.push(s); continue; }
    if (!others.has(s.workspace.id)) others.set(s.workspace.id, { workspace: s.workspace, sessions: [] });
    others.get(s.workspace.id).sessions.push(s);
  }
  return { local, others: [...others.values()] };
}

function syncDesk(s, slot) {
  const desk = desks.get(s.id) ?? createDesk(s, slot, !firstPoll);
  placeDesk(desk, slot);
  if (s.turns > desk.turns && s.lastUser && !s.remote) queueVisit(desk.id, s.lastUser.text); // someone asked this session
  if (s.lastAnswer && s.lastAnswer.ts !== desk.answerTs) sayAnswer(desk, s.lastAnswer.text); // it answered
  desk.turns = s.turns; desk.answerTs = s.lastAnswer?.ts; desk.session = s;
  syncClawds(desk, s.subagents ?? []);
  desk.label.replaceChildren(agentEnvironment(s, true), ' ', clip(s.title || s.name, LABEL_LENGTH));
  desk.label.className = 'label' + (s.status === 'busy' ? ' busy' : '');
}

export async function poll() {
  let sessions, rigs;
  try { [sessions, rigs] = await Promise.all([fetchSessions(), fetchRigs()]); } catch { return; }
  tagRigMembers(sessions, rigs);
  updateHeadcount(sessions);
  const { local, others } = groupByWorkspace(sessions);
  if (layout(local.length)) buildRoom();
  arrangeOffices(others.map(o => ({ workspace: o.workspace, count: o.sessions.length })));
  const liveIds = new Set(sessions.map(s => s.id));
  for (const desk of [...desks.values()]) if (!liveIds.has(desk.id) && !desk.leaving && !desk.fading) sendHome(desk, firedIds.has(desk.id));
  local.forEach((s, i) => syncDesk(s, deskSlot(i)));
  for (const office of others) office.sessions.forEach((s, i) => syncDesk(s, officeSlot(office.workspace.id, i)));
  updateRigLinks(rigs);
  if (firstPoll) placeVisitorAtHome();
  firstPoll = false;
  refreshChat();
  renderStaff(sessions);
  renderOffices(local, others, await fetchRemoteStatus().catch(() => null));
}

export function startPolling() {
  setInterval(poll, POLL_MS);
  poll();
}
