// Git changes in a session's working directory, like a GitHub PR: the whole branch since it left its base
// (commits + uncommitted + untracked), each commit on its own, or only what is not committed yet.
// Read-only: never touches the index or the work tree.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const GIT_TIMEOUT_MS = 8000;
const MAX_OUTPUT = 32 * 1024 * 1024; // for listings; patches are read with a cap instead (readPatch)
const MAX_PATCH_BYTES = 8 * 1024 * 1024, MAX_PATCH_PASSES = 3, MAX_RETRY_PATHS = 500; // far more than the page shows
const MAX_BIG_FILES = 20, MAX_BIG_FILE_PATCH_BYTES = 512 * 1024, MAX_UNTRACKED_PATCH_BYTES = 512 * 1024; // enough for MAX_FILE_LINES usual lines
const MAX_UNTRACKED = 100;
const MAX_FILE_LINES = 2000; // lines of one file's patch sent to the page; counts stay exact
const MAX_TOTAL_LINES = 20000;
const MAX_COMMITS = 100, RECENT_COMMITS = 20, MAX_BRANCHES = 200, COMMIT_CACHE = 50;
const MAX_COUNTED_FILE = 1024 * 1024, BINARY_SNIFF = 8000;
const TRUNKS = ['main', 'master', 'develop', 'development', 'dev', 'trunk'];
const TRUNK_DEFAULTS = new Set(['main', 'master']);
const SHA = /^[0-9a-f]{7,40}$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // diff base of a repository with no commits yet
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }; // don't refresh the index while the agent works

// git exits 1 for "--no-index found differences"; that is not an error
function git(cwd, args, okCodes = [0]) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env: GIT_ENV },
      (err, stdout, stderr) => {
        if (err && !okCodes.includes(err.code)) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout);
      });
  });
}

// Reads at most maxBytes of a git command's output, then stops it, so a huge patch (a generated file, a dump)
// costs no more than the part the page can show. { text, cut } where cut = output was longer.
function gitHead(cwd, args, maxBytes, okCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, cut = false, stderr = '';
    const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
    child.stdout.on('data', chunk => {
      if (cut) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) { cut = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (!cut && !okCodes.includes(code)) return reject(new Error(stderr.trim() || `git exited with ${code ?? 'a timeout'}`));
      let text = Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
      if (cut) text = text.slice(0, text.lastIndexOf('\n') + 1); // drop the line (and character) cut in half
      resolve({ text, cut });
    });
  });
}

// A Windows-side session read from WSL records C:\path; git in WSL sees it as /mnt/c/path.
function localPath(cwd, host) {
  if (host !== 'win' || process.platform === 'win32') return cwd;
  const drive = /^([a-zA-Z]):[\\/](.*)$/.exec(cwd);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}` : cwd;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const unquote = p => p.startsWith('"') ? JSON.parse(p) : p; // paths with odd characters stay C-quoted
// "--- a/name" (+ a tab when the name has spaces) -> name; /dev/null -> null
const stripPrefix = p => (p = p.replace(/\t$/, '')) === '/dev/null' ? null : unquote(p).replace(/^[ab]\//, '');

// Unified diff text -> [{ path, oldPath, status, additions, deletions, binary, hunks: [{ header, lines: [{ type, old, new, text }] }] }]
function parseDiff(text) {
  const files = [];
  let file = null, hunk = null, oldLine = 0, newLine = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: null, oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: false, hunks: [], lines: 0, truncated: false };
      const names = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      if (names) { file.oldPath = names[1]; file.path = names[2]; }
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = unquote(line.slice(12)); }
      else if (line.startsWith('rename to ')) file.path = unquote(line.slice(10));
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
      else if (line.startsWith('--- ')) { const p = stripPrefix(line.slice(4)); if (p) file.oldPath = p; else file.status = 'added'; }
      else if (line.startsWith('+++ ')) { const p = stripPrefix(line.slice(4)); if (p) file.path = p; else file.status = 'deleted'; }
    }
    const header = HUNK.exec(line);
    if (header) {
      oldLine = +header[1]; newLine = +header[2];
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const mark = line[0];
    let entry = null;
    if (mark === '+') { file.additions++; entry = { type: 'add', new: newLine++ }; }
    else if (mark === '-') { file.deletions++; entry = { type: 'del', old: oldLine++ }; }
    else if (mark === ' ') entry = { type: 'ctx', old: oldLine++, new: newLine++ };
    else if (mark === '\\') entry = { type: 'note' }; // "\ No newline at end of file"
    if (!entry) continue;
    entry.text = line.slice(1);
    if (++file.lines <= MAX_FILE_LINES) hunk.lines.push(entry);
  }
  for (const f of files) {
    f.path ??= f.oldPath;
    if (f.status !== 'renamed') f.oldPath = null;
  }
  return files.filter(f => f.path);
}

// Keeps the whole response a size the page can render; counts and the file list stay complete.
function capLines(files) {
  let total = 0;
  for (const f of files) {
    f.truncated ||= f.lines > MAX_FILE_LINES;
    if (total >= MAX_TOTAL_LINES) { f.hunks = []; f.truncated = f.lines > 0; }
    total += Math.min(f.lines, MAX_FILE_LINES);
    delete f.lines;
  }
  return files;
}

const untrackedNames = async root => (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);

// lines of one new file as git counts them (0 for binary)
const newFileLines = async (root, name) =>
  +(await git(root, ['diff', '--no-index', '--numstat', '--', '/dev/null', name], [0, 1]).catch(() => '')).split('\t')[0] || 0;

async function untrackedFiles(root, names) {
  const lists = await Promise.all(names.slice(0, MAX_UNTRACKED).map(async name => {
    const args = ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', name];
    const { text, cut } = await gitHead(root, args, MAX_UNTRACKED_PATCH_BYTES, [0, 1]).catch(() => ({ text: '', cut: false }));
    const files = parseDiff(text);
    if (cut && files[0]) Object.assign(files[0], { truncated: true, additions: await newFileLines(root, name) });
    return files;
  }));
  return lists.flat();
}

// Line counts of new files, read directly: one git process per file on every refresh would be too many.
// Files too big to read every few seconds ask git instead.
async function untrackedLines(root, names) {
  let lines = 0;
  for (const name of names.slice(0, MAX_UNTRACKED)) {
    try {
      const file = path.join(root, name);
      if (fs.statSync(file).size > MAX_COUNTED_FILE) { lines += await newFileLines(root, name); continue; }
      const text = fs.readFileSync(file);
      if (!text.length || text.subarray(0, BINARY_SNIFF).includes(0)) continue;
      lines += text.toString('utf8').split('\n').length - (text.at(-1) === 0x0a ? 1 : 0);
    } catch {}
  }
  return lines;
}

const STATUS_LETTER = { A: 'added', C: 'added', D: 'deleted', R: 'renamed' };

// `git diff -z --numstat` -> [{ path, oldPath, additions, deletions, binary }]; a rename is "a\td\t\0old\0new\0"
function parseNumstatZ(text) {
  const parts = text.split('\0'), out = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(parts[i]);
    if (!m) continue;
    let file = m[3], oldPath = null;
    if (file === '') { oldPath = parts[++i]; file = parts[++i]; }
    out.push({ path: file, oldPath, binary: m[1] === '-', additions: +m[1] || 0, deletions: +m[2] || 0 });
  }
  return out;
}

// `git diff -z --name-status` -> Map(path -> status); a rename or copy is "R100\0old\0new\0"
function parseNameStatusZ(text) {
  const parts = text.split('\0'), out = new Map();
  for (let i = 0; i < parts.length; i++) {
    const letter = parts[i][0];
    if (!letter) continue;
    if (letter === 'R' || letter === 'C') i++;
    out.set(parts[++i], STATUS_LETTER[letter] ?? 'modified');
  }
  return out;
}

const literal = n => [n.oldPath, n.path].filter(Boolean).map(p => ':(literal)' + p);

// Everything but the long files, within MAX_PATCH_BYTES per read. A read cut short (say, by a minified file of one
// endless line) gives up on the file it stopped in and reads again from the files it never reached.
async function readRest(root, diff, pending, pathspec) {
  const files = [];
  for (let pass = 0; pass < MAX_PATCH_PASSES && pending.length; pass++) {
    const read = await gitHead(root, [...diff, ...pathspec], MAX_PATCH_BYTES);
    const parsed = parseDiff(read.text);
    files.push(...parsed);
    if (!read.cut) break;
    if (parsed.length) parsed.at(-1).truncated = true;
    const seen = new Set(parsed.map(f => f.path));
    pending = pending.filter(n => !seen.has(n.path));
    pathspec = pending.slice(0, MAX_RETRY_PATHS).flatMap(literal);
  }
  return files;
}

// The patch of a range. Files too long to show in full (by numstat) are read on their own with a small cap, so one
// generated file can't use up the budget of the rest; whatever the main read still can't reach is listed with exact
// counts but no diff, so the tree and the totals stay complete.
async function readPatch(root, range) {
  const diff = ['diff', '--no-color', '--no-ext-diff', '-M', ...range, '--'];
  const counts = await git(root, ['diff', '-z', '-M', '--numstat', ...range]).then(parseNumstatZ);
  const big = counts.filter(n => n.additions + n.deletions > MAX_FILE_LINES).slice(0, MAX_BIG_FILES);
  const exclude = big.flatMap(n => [n.oldPath, n.path].filter(Boolean).map(p => ':(exclude,literal)' + p));
  const [files, alone] = await Promise.all([
    readRest(root, diff, counts.filter(n => !big.includes(n)), ['.', ...exclude]),
    Promise.all(big.map(n => gitHead(root, [...diff, ...literal(n)], MAX_BIG_FILE_PATCH_BYTES))),
  ]);
  for (const read of alone) {
    const parsed = parseDiff(read.text);
    if (read.cut && parsed.length) parsed.at(-1).truncated = true;
    files.push(...parsed);
  }
  const byPath = new Map(files.map(f => [f.path, f]));
  const missing = counts.filter(n => !byPath.has(n.path));
  const statuses = missing.length ? await git(root, ['diff', '-z', '-M', '--name-status', ...range]).then(parseNameStatusZ) : new Map();
  for (const n of counts) {
    const f = byPath.get(n.path);
    if (f) Object.assign(f, { additions: n.additions, deletions: n.deletions, binary: f.binary || n.binary });
    else files.push({ ...n, status: statuses.get(n.path) ?? (n.oldPath ? 'renamed' : 'modified'), hunks: [], lines: 0, truncated: true });
  }
  return files;
}

// "added\tdeleted\tpath" lines ("-" for binary) -> { files, additions, deletions }
function sumNumstat(text) {
  const stats = { files: 0, additions: 0, deletions: 0 };
  for (const line of text.split('\n')) {
    const [a, d] = line.split('\t');
    if (d === undefined) continue;
    stats.files++;
    stats.additions += +a || 0;
    stats.deletions += +d || 0;
  }
  return stats;
}

// Working tree (tracked + untracked) against a commit: the numbers next to "전체" and "커밋하지 않은 변경".
async function statsAgainst(root, rev, untracked) {
  const stats = sumNumstat(await git(root, ['diff', '--numstat', '-M', rev]));
  stats.files += untracked.length;
  stats.additions += await untrackedLines(root, untracked);
  return stats;
}

// Branches to compare against, short names like "develop" or "origin/main", and where origin/HEAD points.
async function listBranches(root) {
  const out = await git(root, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes']);
  const names = [];
  let remoteHead = null;
  for (const line of out.split('\n')) {
    const [ref, symref] = line.split('\0');
    if (!ref) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    if (symref) { remoteHead ??= symref.replace(/^refs\/remotes\//, ''); continue; }
    names.push(name);
  }
  return { names: names.slice(0, MAX_BRANCHES), remoteHead };
}

const shortName = ref => ref.replace(/^[^/]+\//, '');
const aheadOf = async (root, ref) => +(await git(root, ['rev-list', '--count', `${ref}..HEAD`])).trim();

// The branch this one grew from, like a PR's base: among the usual trunks (origin/ preferred over a stale local copy),
// the one HEAD is fewest commits ahead of. The default branch itself has no base.
async function pickBase(root, branch, names, remoteHead) {
  if (branch && (TRUNK_DEFAULTS.has(branch) || (remoteHead && shortName(remoteHead) === branch))) return null;
  const upstream = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(s => s.trim()).catch(() => '');
  const wanted = [...new Set([remoteHead && shortName(remoteHead), ...TRUNKS].filter(Boolean))];
  const candidates = [];
  for (const trunk of wanted) {
    const ref = names.find(n => n.includes('/') && shortName(n) === trunk) ?? names.find(n => n === trunk);
    if (ref && ref !== branch && ref !== upstream && shortName(ref) !== branch) candidates.push(ref);
  }
  let best = null;
  for (const ref of candidates) {
    const ahead = await aheadOf(root, ref).catch(() => null);
    if (ahead !== null && (!best || ahead < best.ahead)) best = { ref, ahead };
  }
  return best;
}

// git log with per-commit +/- (a merge counts nothing, like git log's default numstat)
async function listCommits(root, range) {
  const out = await git(root, ['log', `-n${MAX_COMMITS}`, '--numstat', '--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%aI', range, '--']);
  return out.split('\x1e').filter(s => s.trim()).map(chunk => {
    const [header, ...rest] = chunk.split('\n');
    const [sha, short, subject, author, date] = header.split('\x1f');
    return { sha, short, subject, author, date, ...sumNumstat(rest.join('\n')) };
  });
}

const commitCache = new Map(); // commits never change, so their diffs are parsed once

async function commitDiff(root, sha) {
  const full = (await git(root, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])).trim();
  const key = root + full;
  if (commitCache.has(key)) return commitCache.get(key);
  const parent = await git(root, ['rev-parse', '--verify', '--quiet', `${full}^`]).then(s => s.trim()).catch(() => '');
  const [patchFiles, meta] = await Promise.all([
    readPatch(root, [parent || EMPTY_TREE, full]),
    git(root, ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%B', full]),
  ]);
  const [, short, author, date, parents, message] = meta.split('\x1f');
  const result = {
    commit: { sha: full, short, author, date, merge: parents.trim().split(' ').length > 1, message: message.trim() },
    files: capLines(patchFiles),
  };
  if (commitCache.size >= COMMIT_CACHE) commitCache.delete(commitCache.keys().next().value);
  commitCache.set(key, result);
  return result;
}

// What the 변경 사항 tab shows for one session. view: 'all' (base -> working tree, the whole branch),
// 'worktree' (HEAD -> working tree) or a commit sha; base: a branch name to override the guess.
// { root, branch, base, branches, commits, commitsInBase, totals, view, commit, files, additions, deletions, skippedUntracked }
// or { error } when cwd is not a git work tree.
async function sessionDiff(cwd, host, { view = 'all', base: requestedBase } = {}) {
  if (!cwd) return { error: '작업 경로를 알 수 없습니다' };
  const dir = localPath(cwd, host);
  let root;
  try { root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim(); } catch { return { error: 'git 저장소가 아닙니다' }; }
  const [branch, head, { names, remoteHead }, untracked] = await Promise.all([
    git(root, ['branch', '--show-current']).then(s => s.trim()).catch(() => ''),
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(s => s.trim()).catch(() => ''),
    listBranches(root),
    untrackedNames(root),
  ]);

  let base = null;
  if (head) {
    if (requestedBase && names.includes(requestedBase)) base = { ref: requestedBase, ahead: await aheadOf(root, requestedBase).catch(() => 0) };
    else if (requestedBase !== '') base = await pickBase(root, branch, names, remoteHead); // '' = the reader chose no base
    if (base) base.mergeBase = (await git(root, ['merge-base', base.ref, 'HEAD']).catch(() => '')).trim() || null;
    if (base && !base.mergeBase) base = null; // unrelated histories
  }
  const commitsInBase = !base?.ahead; // nothing of its own: show recent history instead
  const [commits, worktreeStats, allStats] = await Promise.all([
    head ? listCommits(root, commitsInBase ? 'HEAD' : `${base.mergeBase}..HEAD`).then(c => commitsInBase ? c.slice(0, RECENT_COMMITS) : c) : [],
    statsAgainst(root, head || EMPTY_TREE, untracked),
    base ? statsAgainst(root, base.mergeBase, untracked) : null,
  ]);

  let shown;
  if (SHA.test(view) && head) shown = await commitDiff(root, view).catch(() => null);
  if (!shown) {
    view = view === 'worktree' || !base ? 'worktree' : 'all'; // unknown commits fall back to the default
    const from = view === 'all' ? base.mergeBase : head || EMPTY_TREE;
    const [tracked, newFiles] = await Promise.all([readPatch(root, [from]), untrackedFiles(root, untracked)]);
    shown = { commit: null, files: capLines([...tracked, ...newFiles]) };
  } else view = shown.commit.sha;
  const files = [...shown.files].sort((a, b) => a.path.localeCompare(b.path));
  return {
    root: path.basename(root), branch: branch || (head ? head.slice(0, 7) : ''),
    base: base && { ref: base.ref, ahead: base.ahead, mergeBase: base.mergeBase.slice(0, 7) },
    branches: names, commits, commitsInBase,
    totals: { all: allStats, worktree: worktreeStats },
    view, commit: shown.commit, files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    skippedUntracked: Math.max(0, untracked.length - MAX_UNTRACKED),
  };
}

module.exports = { sessionDiff, parseDiff, localPath };
