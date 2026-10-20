// "사무실" tab: one row per workspace (local, each remote PC, cloud). Clicking one zooms the camera to that office.
import { officeView } from '../world/offices.js';
import { focusOnBounds, localOfficeBounds } from './camera-focus.js';
import { el } from './labels.js';
import { selectedOffice, selectOffice, onOfficeChange, keepSelectionIn } from './office-selection.js';

const ICON = { local: '🏢 ', remote: '📡 ', cloud: '☁️ ' };
const list = document.getElementById('offices');
let renderedKey = '', lastRender = null;

const countsOf = sessions => {
  const busy = sessions.filter(s => s.status === 'busy').length, waiting = sessions.filter(s => s.status === 'waiting').length;
  return [`세션 ${sessions.length}개`, busy && `작업 중 ${busy}`, waiting && `답변 대기 ${waiting}`].filter(Boolean).join(' · ');
};

function officeRow({ id, kind, name }, sessions, bounds) {
  const row = el('div', 'row' + (id === selectedOffice() ? ' on' : '')), main = el('div', 'main');
  main.append(el('div', 't', ICON[kind] + name), el('div', 's', countsOf(sessions)));
  row.append(main);
  row.onclick = () => {
    const b = bounds();
    if (b) focusOnBounds(b);
    selectOffice(id);
  };
  return row;
}

// remote: { enabled, error } from the server, or null when unknown
function remoteNote(remote) {
  if (!remote?.enabled) return el('div', 'empty', '원격·클라우드 세션 표시가 꺼져 있습니다 (REMOTE=0).');
  if (remote.error) return el('div', 'empty', '원격 세션을 불러오지 못했습니다: ' + remote.error);
  return null;
}

export function renderOffices(local, others, remote) {
  lastRender = [local, others, remote];
  keepSelectionIn(['local', ...others.map(o => o.workspace.id)]);
  const key = JSON.stringify([selectedOffice(), local.map(s => s.status), others.map(o => [o.workspace.id, o.sessions.map(s => s.status)]), remote]);
  if (key === renderedKey) return;
  renderedKey = key;
  const rows = [officeRow({ id: 'local', kind: 'local', name: '로컬' }, local, localOfficeBounds)];
  // remote PCs first, the cloud last
  const sorted = [...others].sort((a, b) => (a.workspace.kind === 'cloud') - (b.workspace.kind === 'cloud'));
  for (const { workspace, sessions } of sorted) rows.push(officeRow(workspace, sessions, () => officeView(workspace.id)));
  const note = remoteNote(remote);
  list.replaceChildren(...rows, ...(note ? [note] : []));
}

onOfficeChange(() => { if (lastRender) renderOffices(...lastRender); }); // move the highlight
