// Right-hand panel with the selected session's status and chat log. Refreshed on every poll while open.
import { fetchSession } from '../api.js';
import { clip } from '../core/overlay.js';
import { desks } from '../world/state.js';
import { renderMarkdown } from './markdown.js';
import { agentEnvironment, el } from './labels.js';
import { loadDiff, resetDiff } from './diff-view.js';

const MIN_WIDTH = 320, MARGIN = 80, STICK_TO_BOTTOM_PX = 40;
const WIDTH_KEY = 'panelWidth';
const DIFF_REFRESH_MS = 5000, DIFF_BADGE_REFRESH_MS = 30000; // git runs per refresh, so slower than the 2s poll

const panel = document.getElementById('panel'), chat = document.getElementById('chat'), diff = document.getElementById('diff');
const tabs = document.getElementById('p-tabs'), diffCount = document.getElementById('diff-count');
let selectedId = null;
let renderedKey = ''; // what the chat log currently shows, so unchanged polls keep scroll + open tool groups
let view = 'chat', diffAt = 0;

export const selectedSession = () => selectedId;

export function closeChat() {
  panel.classList.remove('open');
  selectedId = null;
}

function statusChip(status) {
  if (status === 'unknown') return el('span', 'chip', '상태 미확인');
  const busy = status === 'busy', waiting = status === 'waiting';
  return el('span', 'chip ' + (busy ? 'busy' : waiting ? 'wait' : ''), busy ? '● 작업 중' : waiting ? '? 답변 대기' : '휴식 중');
}

function renderHeader(s) {
  document.getElementById('p-title').textContent = s.title || s.name;
  const meta = document.getElementById('p-meta'), rig = desks.get(s.id)?.session.rig;
  meta.replaceChildren(statusChip(s.status), agentEnvironment(s));
  meta.append(' · ' + [rig && `rig ${rig.name}/${rig.logicalId}`, !s.remote && `턴 ${s.turns}`, s.name, s.cwd].filter(Boolean).join(' · '));
  if (s.statusNote) meta.append(`\n${s.statusNote}`);
  if (s.subagents?.length) {
    meta.append(`\n서브에이전트 ${s.subagents.length}개 실행 중: ` + s.subagents.map(a => `${a.type} (${clip(a.description, 40)})`).join(', '));
  }
}

// consecutive tool calls fold into one <details> group
function toolGroup() {
  const group = el('details', 'tools');
  group.count = 0;
  group.append(el('summary'));
  return group;
}

function renderMessages(messages) {
  const out = [];
  let tools = null;
  for (const m of messages) {
    if (m.role === 'tool') {
      if (!tools) out.push(tools = toolGroup());
      tools.append(el('div', '', m.text));
      tools.querySelector('summary').textContent = `도구 ${++tools.count}회 사용 · ${m.text.split(':')[0]}`;
      continue;
    }
    tools = null;
    const message = el('div', 'm ' + m.role);
    if (m.role === 'user') {
      message.textContent = m.text;
      out.push(message, el('div', 'ts', `턴 ${m.turn} · ${new Date(m.ts).toLocaleString()}`));
    } else {
      message.innerHTML = renderMarkdown(m.text);
      out.push(message);
    }
  }
  return out;
}

function showView(next) {
  view = next;
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === view);
  chat.hidden = view !== 'chat';
  diff.hidden = view !== 'diff';
}

// remote and cloud sessions work on another machine, so only local ones have a diff to show
async function refreshDiff(s, force) {
  tabs.hidden = !!s.remote;
  if (s.remote) return showView('chat');
  if (!force && Date.now() - diffAt < (view === 'diff' ? DIFF_REFRESH_MS : DIFF_BADGE_REFRESH_MS)) return;
  diffAt = Date.now();
  await loadDiff(s.id, () => selectedId === s.id, d => {
    const files = d.totals ? (d.totals.all ?? d.totals.worktree).files : 0; // the whole branch once it was counted
    diffCount.textContent = files ? String(files) : '';
  });
}

// refresh = a poll update of the open session (keeps the reader's scroll position unless they were at the bottom)
export async function openChat(id, refresh = false) {
  if (!refresh) {
    renderedKey = '';
    resetDiff();
    diffCount.textContent = '';
  }
  selectedId = id;
  const s = await fetchSession(id);
  if (!s || selectedId !== id) return;
  renderHeader(s);
  refreshDiff(s, !refresh);
  const key = id + s.chat.length + (s.chat.at(-1)?.ts ?? '');
  if (key !== renderedKey) {
    renderedKey = key;
    const stick = !refresh || chat.scrollHeight - chat.scrollTop - chat.clientHeight < STICK_TO_BOTTOM_PX;
    chat.replaceChildren(...renderMessages(s.chat));
    if (stick) chat.scrollTop = chat.scrollHeight;
  }
  panel.classList.add('open');
}

export function refreshChat() {
  if (selectedId) openChat(selectedId, true);
}

// drag the left edge to resize; the width is remembered per browser
function initResizeGrip() {
  const grip = document.getElementById('grip');
  const setWidth = w => { panel.style.width = Math.max(MIN_WIDTH, Math.min(innerWidth - MARGIN, w)) + 'px'; };
  try { const saved = +localStorage.getItem(WIDTH_KEY); if (saved) setWidth(saved); } catch {}
  grip.addEventListener('pointerdown', e => { grip.setPointerCapture(e.pointerId); grip.classList.add('drag'); });
  grip.addEventListener('pointermove', e => { if (grip.classList.contains('drag')) setWidth(innerWidth - e.clientX); });
  grip.addEventListener('pointerup', () => {
    grip.classList.remove('drag');
    try { localStorage.setItem(WIDTH_KEY, parseInt(panel.style.width)); } catch {}
  });
}

export function initChatPanel() {
  document.getElementById('close').onclick = closeChat;
  for (const b of tabs.querySelectorAll('button')) b.onclick = () => {
    showView(b.dataset.view);
    if (view === 'diff' && selectedId) { diffAt = 0; refreshChat(); }
  };
  initResizeGrip();
}
