// "변경 사항" tab of the chat panel: the session's uncommitted git changes, like GitHub's "Files changed" —
// a file tree with per-file +/- counts, then each file's diff with line numbers.
import { fetchDiff } from '../api.js';
import { el } from './labels.js';

const STAT_BLOCKS = 5;
const AUTO_OPEN_FILES = 30, AUTO_OPEN_LINES = 400; // bigger diffs start folded, like GitHub's "Load diff"
const STATUS_MARK = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };
const STATUS_NAME = { added: '추가', modified: '수정', deleted: '삭제', renamed: '이름 변경' };

const pane = document.getElementById('diff');
let renderedKey = '';
const folded = new Set(), unfolded = new Set(); // the reader's own open/close choices survive refreshes

// GitHub's five-square diffstat: green for additions, red for deletions, grey for the rest
function statBar(additions, deletions) {
  const total = additions + deletions, bar = el('span', 'diffstat');
  const add = total ? Math.round(additions / total * STAT_BLOCKS) : 0;
  const del = total ? Math.min(STAT_BLOCKS - add, Math.round(deletions / total * STAT_BLOCKS)) : 0;
  for (let i = 0; i < STAT_BLOCKS; i++) bar.append(el('i', i < add ? 'add' : i < add + del ? 'del' : ''));
  return bar;
}

function counts(f) {
  const out = el('span', 'counts');
  if (f.binary) out.append(el('span', 'bin', 'BIN'));
  else out.append(el('span', 'add', '+' + f.additions), el('span', 'del', '−' + f.deletions));
  return out;
}

function statusMark(status) {
  const mark = el('span', 'fstatus ' + status, STATUS_MARK[status] ?? 'M');
  mark.title = STATUS_NAME[status] ?? status;
  return mark;
}

// path list -> nested { dirs: Map, files: [] }; single-child folders merge ("src/ui") as on GitHub
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push({ name: parts.at(-1), file: f });
  }
  return root;
}

function compact(name, node) {
  while (node.files.length === 0 && node.dirs.size === 1) {
    const [child, next] = [...node.dirs][0];
    name += '/' + child; node = next;
  }
  return [name, node];
}

function renderTree(node, depth, sections) {
  const out = [];
  for (const [dirName, dirNode] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
    const [name, child] = compact(dirName, dirNode);
    const dir = el('details', 'tdir');
    dir.open = true;
    const summary = el('summary', '', '📁 ' + name);
    summary.style.paddingLeft = depth * 12 + 'px';
    dir.append(summary, ...renderTree(child, depth + 1, sections));
    out.push(dir);
  }
  for (const { name, file } of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    const row = el('div', 'tfile');
    row.style.paddingLeft = depth * 12 + 4 + 'px';
    row.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    row.append(statusMark(file.status), el('span', 'name', name), counts(file));
    row.onclick = () => {
      const section = sections.get(file.path);
      section.open = true;
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    out.push(row);
  }
  return out;
}

function lineRow(line) {
  const row = el('tr', 'l-' + line.type);
  if (line.type === 'note') {
    row.append(el('td', 'ln'), el('td', 'ln'), el('td', 'code', line.text));
    return row;
  }
  const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  row.append(el('td', 'ln', line.old ?? ''), el('td', 'ln', line.new ?? ''), el('td', 'code', sign + line.text));
  return row;
}

function fileSection(f, autoOpen) {
  const section = el('details', 'dfile');
  section.open = unfolded.has(f.path) || (!folded.has(f.path) && autoOpen);
  section.ontoggle = () => {
    (section.open ? unfolded : folded).add(f.path);
    (section.open ? folded : unfolded).delete(f.path);
  };
  const summary = el('summary');
  summary.append(statusMark(f.status), el('span', 'fpath', f.oldPath ? `${f.oldPath} → ${f.path}` : f.path), counts(f), statBar(f.additions, f.deletions));
  section.append(summary);
  if (f.binary) section.append(el('div', 'dnote', '바이너리 파일은 표시하지 않습니다'));
  else if (!f.hunks.length) section.append(el('div', 'dnote', f.truncated ? '변경 내용이 너무 많아 생략했습니다' : f.status === 'renamed' ? '내용 변경 없이 이름만 바뀌었습니다' : '내용 변경이 없습니다 (권한 등)'));
  else {
    const table = el('table', 'dtable');
    for (const hunk of f.hunks) {
      const header = el('tr', 'l-hunk');
      header.append(el('td', 'ln'), el('td', 'ln'), el('td', 'code', hunk.header));
      table.append(header, ...hunk.lines.map(lineRow));
    }
    section.append(table);
    if (f.truncated) section.append(el('div', 'dnote', '일부만 표시했습니다. 전체는 터미널에서 git diff로 확인해 주세요'));
  }
  return section;
}

function render(d) {
  if (d.error) return [el('div', 'empty', d.error)];
  if (!d.files.length) return [el('div', 'empty', `${d.root}${d.branch ? ` (${d.branch})` : ''} · 커밋하지 않은 변경 사항이 없습니다`)];
  const head = el('div', 'dsummary');
  head.append(el('b', '', `${d.files.length}개 파일 변경`), ' ', el('span', 'add', '+' + d.additions), ' ', el('span', 'del', '−' + d.deletions), ' ',
    statBar(d.additions, d.deletions), el('div', 'dmeta', `${d.root}${d.branch ? ` · ${d.branch}` : ''} · HEAD 대비 작업 트리 (추적 안 된 파일 포함)`));
  if (d.skippedUntracked) head.append(el('div', 'dmeta', `추적하지 않는 새 파일 ${d.skippedUntracked}개는 생략했습니다`));
  const autoOpen = f => d.files.length <= AUTO_OPEN_FILES && f.additions + f.deletions <= AUTO_OPEN_LINES;
  const sections = new Map(d.files.map(f => [f.path, fileSection(f, autoOpen(f))]));
  const tree = el('nav', 'dtree');
  tree.append(el('div', 'dtitle', '파일 트리'), ...renderTree(buildTree(d.files), 0, sections));
  const list = el('div', 'dfiles');
  list.append(...sections.values());
  const body = el('div', 'dbody');
  body.append(tree, list);
  return [head, body];
}

export function resetDiff() {
  renderedKey = '';
  folded.clear(); unfolded.clear();
  pane.replaceChildren(el('div', 'empty', '불러오는 중…'));
}

// returns the diff so the tab can show its file count, or null when another session was opened meanwhile;
// unchanged diffs keep scroll and folds
export async function loadDiff(id, isCurrent) {
  const d = await fetchDiff(id).catch(e => ({ error: '변경 사항을 불러오지 못했습니다: ' + e.message }));
  if (!isCurrent()) return null;
  const key = id + JSON.stringify(d);
  if (key !== renderedKey) {
    renderedKey = key;
    const scroll = pane.scrollTop;
    pane.replaceChildren(...render(d));
    pane.scrollTop = scroll;
  }
  return d;
}
