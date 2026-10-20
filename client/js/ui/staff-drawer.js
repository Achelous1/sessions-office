// "직원 목록" drawer: offices (see offices-tab.js), live staff (click to zoom in, fire to terminate or archive)
// and past local sessions with a resume command.
import { fetchHistory, fireSession } from '../api.js';
import { clip } from '../core/overlay.js';
import { desks, firedIds } from '../world/state.js';
import { openChat, closeChat, selectedSession } from './chat-panel.js';
import { focusOnEmployee } from './camera-focus.js';
import { HOST_NAME, STATUS_NAME, placeOf, el } from './labels.js';
import { selectedOffice, onOfficeChange, officeOf } from './office-selection.js';

const STATUS_ORDER = { waiting: 0, busy: 1 }; // everyone else after
const COPIED_MS = 1500;

const drawer = document.getElementById('drawer');
const staffList = document.getElementById('staff'), historyList = document.getElementById('history');
const panes = { offices: document.getElementById('offices'), staff: staffList, history: historyList };
let renderedStaffKey = '', lastSessions = [];
let onFired = () => {};

function confirmFire(s) {
  if (s.remote) return confirm(`'${s.title || s.name}' 세션을 해고(아카이브)할까요?\n원격 세션은 아카이브되어 사라지며, 여기서 다시 살릴 수는 없습니다.`);
  const desktopNote = s.entrypoint === 'claude-desktop' ? '\n데스크톱 앱 세션이라 앱 사이드바에는 오류 상태로 남을 수 있습니다.' : '';
  return confirm(`'${s.title || s.name}' 세션을 해고(종료)할까요?\n진행 중인 작업은 중단됩니다. 히스토리 탭에서 복구 명령으로 다시 열 수 있습니다.${desktopNote}`);
}

async function fire(s) {
  if (!confirmFire(s)) return;
  try {
    await fireSession(s.id);
    firedIds.add(s.id);
    if (selectedSession() === s.id) closeChat();
  } catch (e) {
    alert('종료하지 못했습니다: ' + e.message);
  }
  onFired();
}

function staffRow(s) {
  const row = el('div', 'row'), main = el('div', 'main'), fireButton = el('button', 'fire', '해고');
  main.append(el('div', 't', s.title || s.name),
              el('div', 's', [STATUS_NAME[s.status] ?? s.status, s.name, placeOf(s), !s.remote && `턴 ${s.turns}`].filter(Boolean).join(' · ')));
  row.append(el('span', 'dot ' + s.status), main, fireButton);
  row.onclick = () => {
    const desk = desks.get(s.id);
    if (desk) focusOnEmployee(desk.worker.obj);
    openChat(s.id);
  };
  fireButton.onclick = e => { e.stopPropagation(); fire(s); };
  return row;
}

// The employees of the office selected in the 사무실 tab: waiting first, then busy, then idle.
// Re-renders only when something visible changed.
export function renderStaff(sessions) {
  lastSessions = sessions;
  const office = selectedOffice();
  const rows = sessions.filter(s => officeOf(s) === office).sort((a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2));
  const key = JSON.stringify([office, rows.map(s => [s.id, s.status, s.turns, s.title])]);
  if (key === renderedStaffKey) return;
  renderedStaffKey = key;
  staffList.replaceChildren(...(rows.length ? rows.map(staffRow) : [el('div', 'empty', '이 사무실에는 직원이 없습니다.')]));
}

async function copyCommand(command, button) {
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = '복사됨';
    setTimeout(() => button.textContent = '복사', COPIED_MS);
  } catch {
    prompt('아래 명령을 복사해서 터미널에 붙여넣으세요.', command);
  }
}

function historyRow(h) {
  const row = el('div', 'row'), main = el('div', 'main'), copy = el('button', '', '복사');
  const folder = h.cwd?.split(/[\\/]/).pop();
  main.append(el('div', 't', h.title || h.name || clip(h.lastUser, 60) || h.id),
              el('div', 's', [new Date(h.mtime).toLocaleString(), HOST_NAME[h.host], h.name, `턴 ${h.turns}`, folder].filter(Boolean).join(' · ')),
              el('code', '', h.command));
  row.title = h.lastUser || '';
  row.append(main, copy);
  row.onclick = () => copyCommand(h.command, copy);
  return row;
}

async function loadHistory() {
  historyList.replaceChildren(el('div', 'empty', '불러오는 중…'));
  const past = await fetchHistory();
  if (!past.length) return historyList.replaceChildren(el('div', 'empty', '복구할 수 있는 지난 세션이 없습니다.'));
  historyList.replaceChildren(...past.map(historyRow));
}

function selectTab(button) {
  drawer.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b === button));
  for (const [tab, pane] of Object.entries(panes)) pane.hidden = button.dataset.tab !== tab;
  if (button.dataset.tab === 'history') loadHistory();
}

// onFiredSession: called after a fire attempt, to refresh the office right away
export function initStaffDrawer(toggleButton, onFiredSession) {
  onFired = onFiredSession;
  toggleButton.onclick = () => { drawer.hidden = !drawer.hidden; };
  for (const button of drawer.querySelectorAll('.tabs button')) button.onclick = () => selectTab(button);
}

onOfficeChange(() => renderStaff(lastSessions));
