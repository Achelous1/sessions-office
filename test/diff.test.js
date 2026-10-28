const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseDiff, localPath, workingTreeDiff } = require('../server/diff');

test('parseDiff: statuses, counts and line numbers', () => {
  const files = parseDiff([
    'diff --git a/x.txt b/x.txt',
    'index 1..2 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1,3 +1,3 @@ section',
    ' a',
    '-b',
    '+B',
    ' c',
    '\\ No newline at end of file',
    'diff --git a/sp ace.md b/sp ace.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/sp ace.md\t',
    '@@ -0,0 +1 @@',
    '+new',
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
    'diff --git a/gone.bin b/gone.bin',
    'deleted file mode 100644',
    'Binary files a/gone.bin and /dev/null differ',
  ].join('\n'));
  assert.deepEqual(files.map(f => [f.path, f.oldPath, f.status, f.additions, f.deletions, f.binary]), [
    ['x.txt', null, 'modified', 1, 1, false],
    ['sp ace.md', null, 'added', 1, 0, false],
    ['new.txt', 'old.txt', 'renamed', 0, 0, false],
    ['gone.bin', null, 'deleted', 0, 0, true],
  ]);
  assert.deepEqual(files[0].hunks[0].lines.map(l => [l.type, l.old, l.new, l.text]), [
    ['ctx', 1, 1, 'a'], ['del', 2, undefined, 'b'], ['add', undefined, 2, 'B'], ['ctx', 3, 3, 'c'],
    ['note', undefined, undefined, ' No newline at end of file'],
  ]);
});

test('localPath maps a Windows cwd to its WSL mount', () => {
  if (process.platform === 'win32') return;
  assert.equal(localPath('C:\\Users\\me\\proj', 'win'), '/mnt/c/Users/me/proj');
  assert.equal(localPath('/home/me/proj', 'linux'), '/home/me/proj');
});

test('workingTreeDiff: tracked, staged and untracked changes without touching the index', async t => {
  try { execFileSync('git', ['--version']); } catch { return t.skip('git not installed'); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'x\n');
  git('add', '.'); git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n3\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'y\n'); git('add', 'src/b.js');
  fs.writeFileSync(path.join(dir, 'src', 'new.md'), 'hi\n');
  const index = fs.readFileSync(path.join(dir, '.git', 'index'));

  const d = await workingTreeDiff(path.join(dir, 'src'), 'linux');
  assert.deepEqual(d.files.map(f => [f.path, f.status, f.additions, f.deletions]), [
    ['a.txt', 'modified', 1, 0], ['src/b.js', 'modified', 1, 1], ['src/new.md', 'added', 1, 0],
  ]);
  assert.equal(d.additions, 3);
  assert.equal(d.deletions, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.git', 'index')), index);
  assert.match((await workingTreeDiff(os.tmpdir(), 'linux')).error ?? '', /git/);
});
