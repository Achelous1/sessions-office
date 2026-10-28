// Uncommitted changes in a session's working directory, like GitHub's "Files changed": the working tree
// (staged + unstaged + untracked) against HEAD. Read-only: never touches the index or the work tree.
const path = require('path');
const { execFile } = require('child_process');

const GIT_TIMEOUT_MS = 8000;
const MAX_OUTPUT = 32 * 1024 * 1024;
const MAX_UNTRACKED = 100;
const MAX_FILE_LINES = 2000; // lines of one file's patch sent to the page; counts stay exact
const MAX_TOTAL_LINES = 20000;
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
      file = { path: null, oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: false, hunks: [], lines: 0 };
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
    f.truncated = f.lines > MAX_FILE_LINES;
    if (total >= MAX_TOTAL_LINES) { f.hunks = []; f.truncated = f.lines > 0; }
    total += Math.min(f.lines, MAX_FILE_LINES);
    delete f.lines;
  }
  return files;
}

async function untrackedDiffs(root) {
  const names = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const shown = names.slice(0, MAX_UNTRACKED);
  const patches = await Promise.all(shown.map(name =>
    git(root, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', name], [0, 1]).catch(() => '')));
  return { text: patches.join('\n'), skipped: names.length - shown.length };
}

// { root, branch, files, additions, deletions, skippedUntracked } or { error } when cwd is not a git work tree
async function workingTreeDiff(cwd, host) {
  if (!cwd) return { error: '작업 경로를 알 수 없습니다' };
  const dir = localPath(cwd, host);
  let root;
  try { root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim(); } catch { return { error: 'git 저장소가 아닙니다' }; }
  const [branch, head] = await Promise.all([
    git(root, ['branch', '--show-current']).then(s => s.trim()).catch(() => ''),
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(s => s.trim()).catch(() => ''),
  ]);
  const [tracked, untracked] = await Promise.all([
    git(root, ['diff', '--no-color', '--no-ext-diff', '-M', head || EMPTY_TREE]),
    untrackedDiffs(root),
  ]);
  const files = capLines(parseDiff(tracked + '\n' + untracked.text)).sort((a, b) => a.path.localeCompare(b.path));
  return {
    root: path.basename(root), branch: branch || (head ? head.slice(0, 7) : ''), files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    skippedUntracked: untracked.skipped,
  };
}

module.exports = { workingTreeDiff, parseDiff, localPath };
