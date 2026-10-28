const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseDiff, localPath, sessionDiff } = require('../server/diff');

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

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
  git('init', '-q', '-b', 'main');
  return { dir, git, write };
}

const hasGit = () => { try { execFileSync('git', ['--version']); return true; } catch { return false; } };
const paths = d => d.files.map(f => [f.path, f.status, f.additions, f.deletions]);

test('sessionDiff worktree: tracked, staged and untracked changes without touching the index', async t => {
  if (!hasGit()) return t.skip('git not installed');
  const { dir, git, write } = tempRepo(t);
  write('a.txt', '1\n2\n'); write('src/b.js', 'x\n');
  git('add', '.'); git('commit', '-qm', 'init');
  write('a.txt', '1\n2\n3\n');
  write('src/b.js', 'y\n'); git('add', 'src/b.js');
  write('src/new.md', 'hi\n');
  const index = fs.readFileSync(path.join(dir, '.git', 'index'));

  const d = await sessionDiff(path.join(dir, 'src'), 'linux', { view: 'worktree' });
  assert.equal(d.view, 'worktree');
  assert.deepEqual(paths(d), [['a.txt', 'modified', 1, 0], ['src/b.js', 'modified', 1, 1], ['src/new.md', 'added', 1, 0]]);
  assert.deepEqual([d.additions, d.deletions], [3, 1]);
  assert.deepEqual(d.totals.worktree, { files: 3, additions: 3, deletions: 1 });
  assert.equal(d.base, null); // on main: nothing to compare against
  assert.deepEqual(fs.readFileSync(path.join(dir, '.git', 'index')), index);
  assert.match((await sessionDiff(os.tmpdir(), 'linux')).error ?? '', /git/);
});

test('sessionDiff branch: guesses the nearest trunk, lists its commits and shows each one', async t => {
  if (!hasGit()) return t.skip('git not installed');
  const { dir, git, write } = tempRepo(t);
  write('a.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'init');
  git('checkout', '-qb', 'develop'); write('a.txt', 'base\ndev\n'); git('commit', '-qam', 'dev work');
  git('checkout', '-qb', 'feature');
  write('f.txt', 'one\n'); git('add', '.'); git('commit', '-qm', 'feat: one');
  write('f.txt', 'one\ntwo\nthree\n'); git('commit', '-qam', 'feat: two', '-m', 'details');
  write('a.txt', 'base\ndev\nwip\n'); write('n.md', 'new\n');

  const all = await sessionDiff(dir, 'linux');
  assert.equal(all.view, 'all');
  assert.deepEqual([all.base.ref, all.base.ahead], ['develop', 2]); // develop is nearer than main
  assert.equal(all.commitsInBase, false);
  assert.deepEqual(all.commits.map(c => [c.subject, c.files, c.additions]), [['feat: two', 1, 2], ['feat: one', 1, 1]]);
  assert.deepEqual(paths(all), [['a.txt', 'modified', 1, 0], ['f.txt', 'added', 3, 0], ['n.md', 'added', 1, 0]]);
  assert.deepEqual(all.totals.all, { files: 3, additions: 5, deletions: 0 });

  const commit = await sessionDiff(dir, 'linux', { view: all.commits[0].short });
  assert.equal(commit.view, all.commits[0].sha);
  assert.equal(commit.commit.message, 'feat: two\n\ndetails');
  assert.deepEqual(paths(commit), [['f.txt', 'modified', 2, 0]]);

  const fromMain = await sessionDiff(dir, 'linux', { base: 'main' });
  assert.deepEqual([fromMain.base.ref, fromMain.commits.length], ['main', 3]);
  const none = await sessionDiff(dir, 'linux', { base: '' });
  assert.deepEqual([none.base, none.view, none.commitsInBase], [null, 'worktree', true]);
  const unknown = await sessionDiff(dir, 'linux', { view: 'deadbeef' }); // a commit that doesn't exist falls back
  assert.equal(unknown.view, 'all');
});
