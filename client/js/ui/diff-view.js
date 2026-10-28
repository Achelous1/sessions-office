// "변경 사항" tab of the chat panel, like a GitHub PR: pick the whole branch since its base, the uncommitted work
// or one commit, then see a file tree with per-file +/- counts and each file's diff with line numbers.
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

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}분 전`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}시간 전`;
  if (ms < 30 * DAY) return `${Math.round(ms / DAY)}일 전`;
  return new Date(iso).toLocaleDateString();
}

function statCounts(stats) {
  return stats ? counts({ additions: stats.additions, deletions: stats.deletions }) : el('span');
}

// one choice in the 보기 list: the whole branch, uncommitted work, or a single commit
function rangeRow(label, sub, stats, view, d) {
  const row = el('div', 'rrow' + (d.view === view ? ' on' : ''));
  const main = el('div', 'rmain');
  main.append(label, el('div', 'rsub', sub));
  row.append(main, statCounts(stats));
  row.onclick = () => choose({ view });
  return row;
}

function baseSelect(d) {
  const wrap = el('label', 'rbase', '기준 ');
  const picker = el('select');
  picker.append(new Option('없음', ''), ...d.branches.map(name => new Option(name, name)));
  picker.value = d.base?.ref ?? '';
  picker.title = '전체 변경을 어느 브랜치와 비교할지 고릅니다. 처음에는 가장 가까운 main·develop 등을 자동으로 고릅니다';
  picker.onchange = () => choose({ base: picker.value, view: picker.value ? 'all' : 'worktree' });
  wrap.append(picker);
  return wrap;
}

function renderRanges(d) {
  const nav = el('nav', 'drange');
  nav.append(el('div', 'dtitle', '보기'), baseSelect(d));
  if (d.base) {
    nav.append(rangeRow(el('b', '', '전체 변경'), `${d.base.ref}에서 갈라진 뒤 · 커밋 ${d.base.ahead}개 + 작업 트리`, d.totals.all, 'all', d));
  }
  nav.append(rangeRow(el('b', '', '커밋하지 않은 변경'), `HEAD 대비 · 파일 ${d.totals.worktree.files}개`, d.totals.worktree, 'worktree', d));
  if (d.commits.length) {
    nav.append(el('div', 'dtitle', d.commitsInBase ? `최근 커밋 ${d.commits.length}개${d.base ? ` (${d.base.ref}에 이미 포함)` : ''}` : `이 브랜치의 커밋 ${d.commits.length}개`));
    for (const c of d.commits) {
      const label = el('span', 'rsubject');
      label.append(el('code', '', c.short), ' ', c.subject);
      const row = rangeRow(label, `${c.author} · ${ago(c.date)}`, c, c.sha, d);
      row.title = `${c.short} ${c.subject}\n${c.author} · ${new Date(c.date).toLocaleString()}`;
      nav.append(row);
    }
  }
  return nav;
}

function summary(d) {
  const head = el('div', 'dsummary');
  if (d.commit) {
    const [subject, ...body] = d.commit.message.split('\n');
    head.append(el('b', 'csubject', subject));
    if (body.join('\n').trim()) head.append(el('pre', 'cbody', body.join('\n').trim()));
    head.append(el('div', 'dmeta', `${d.commit.short} · ${d.commit.author} · ${new Date(d.commit.date).toLocaleString()}` +
      (d.commit.merge ? ' · 머지 커밋 (첫 번째 부모 대비)' : '')));
  } else {
    head.append(el('b', '', d.view === 'all' ? '브랜치 전체 변경' : '커밋하지 않은 변경'));
    head.append(el('div', 'dmeta', `${d.root}${d.branch ? ` · ${d.branch}` : ''} · ` + (d.view === 'all'
      ? `${d.base.ref}(${d.base.mergeBase})에서 갈라진 뒤의 커밋과 작업 트리 (추적 안 된 파일 포함)`
      : 'HEAD 대비 작업 트리 (추적 안 된 파일 포함)')));
  }
  const line = el('div', 'dcount');
  line.append(`${d.files.length}개 파일 변경 `, el('span', 'add', '+' + d.additions), ' ', el('span', 'del', '−' + d.deletions), ' ', statBar(d.additions, d.deletions));
  head.append(line);
  if (d.skippedUntracked && !d.commit) head.append(el('div', 'dmeta', `추적하지 않는 새 파일 ${d.skippedUntracked}개는 생략했습니다`));
  return head;
}

function render(d) {
  if (d.error) return [el('div', 'empty', d.error)];
  const autoOpen = f => d.files.length <= AUTO_OPEN_FILES && f.additions + f.deletions <= AUTO_OPEN_LINES;
  const sections = new Map(d.files.map(f => [f.path, fileSection(f, autoOpen(f))]));
  const side = el('div', 'dside');
  side.append(renderRanges(d));
  if (d.files.length) {
    const tree = el('nav', 'dtree');
    tree.append(el('div', 'dtitle', '파일 트리'), ...renderTree(buildTree(d.files), 0, sections));
    side.append(tree);
  }
  const list = el('div', 'dfiles');
  list.append(summary(d), ...(d.files.length ? sections.values() : [el('div', 'empty', '변경된 파일이 없습니다')]));
  const body = el('div', 'dbody');
  body.append(side, list);
  return [body];
}

let current = null; // { id, isCurrent, view, base, onLoad }

function choose(next) {
  Object.assign(current, next);
  folded.clear(); unfolded.clear();
  pane.scrollTop = 0;
  load();
}

async function load() {
  const { id, isCurrent, view, base, onLoad } = current;
  const d = await fetchDiff(id, { view, base }).catch(e => ({ error: '변경 사항을 불러오지 못했습니다: ' + e.message }));
  if (!isCurrent() || current?.id !== id) return null;
  if (!d.error) current.view = d.view; // a commit that left the list falls back to a range
  const key = id + JSON.stringify(d);
  if (key !== renderedKey) {
    renderedKey = key;
    const scroll = pane.scrollTop;
    pane.replaceChildren(...render(d));
    pane.scrollTop = scroll;
  }
  onLoad?.(d);
  return d;
}

export function resetDiff() {
  renderedKey = '';
  current = null;
  folded.clear(); unfolded.clear();
  pane.replaceChildren(el('div', 'empty', '불러오는 중…'));
}

// Loads (or refreshes) the open session's diff in the view the reader picked; onLoad gets each result, e.g. for
// the tab's file count. Unchanged diffs keep scroll and folds.
export function loadDiff(id, isCurrent, onLoad) {
  if (current?.id !== id) current = { id, view: 'all', base: undefined };
  Object.assign(current, { isCurrent, onLoad });
  return load();
}
