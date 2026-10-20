const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseTranscriptText, toolHint } = require('../server/transcripts');
const { resumeCommand } = require('../server/sessions');
const { resolveClientFile } = require('../server/static');
const { toRig } = require('../server/rigs');
const { parseWindowsProcesses } = require('../server/processes');

const jsonl = entries => entries.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n');
const user = (content, extra = {}) => ({ type: 'user', message: { content }, timestamp: 't', ...extra });
const assistant = (content, extra = {}) => ({ type: 'assistant', message: { content }, timestamp: 't', ...extra });

test('transcript: chat log, turns, titles and cwd', () => {
  const parsed = parseTranscriptText(jsonl([
    { type: 'ai-title', aiTitle: 'AI title' },
    { type: 'custom-title', customTitle: 'my name' },
    user('first question', { cwd: '/work' }),
    assistant([{ type: 'text', text: 'answer' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.txt' } }]),
    user('<system-reminder>ignored</system-reminder>'),
    user('second question'),
    user('sidechain', { isSidechain: true }),
    'not json',
  ]));
  assert.equal(parsed.title, 'AI title');
  assert.equal(parsed.name, 'my name');
  assert.equal(parsed.cwd, '/work');
  assert.equal(parsed.turns, 2);
  assert.deepEqual(parsed.chat.map(m => [m.role, m.text, m.turn]), [
    ['user', 'first question', 1],
    ['assistant', 'answer', 1],
    ['tool', 'Read: /a.txt', 1],
    ['user', 'second question', 2],
  ]);
});

test('transcript: shell activity counts running foreground and background shells', () => {
  const started = parseTranscriptText(jsonl([
    assistant([{ type: 'tool_use', id: 'fg', name: 'Bash', input: {} }]),
    assistant([{ type: 'tool_use', id: 'bg', name: 'Bash', input: {} }]),
    user([{ type: 'tool_result', tool_use_id: 'bg', content: 'Command running in background with ID: job-1' }]),
  ]));
  assert.equal(started.shell, 2); // fg still waiting + job-1 in the background

  const finished = parseTranscriptText(jsonl([
    assistant([{ type: 'tool_use', id: 'bg', name: 'Bash', input: {} }]),
    user([{ type: 'tool_result', tool_use_id: 'bg', content: 'Command running in background with ID: job-1' }]),
    user('<task-notification><task-id>job-1</task-id><status>completed</status></task-notification>'),
  ]));
  assert.equal(finished.shell, 0);
});

test('toolHint prefers the description and truncates', () => {
  assert.equal(toolHint({ description: 'list files', command: 'ls' }), ': list files');
  assert.equal(toolHint({}), '');
  assert.equal(toolHint({ command: 'x'.repeat(200) }).length, 2 + 120);
});

test('resumeCommand quotes the working directory per shell', () => {
  assert.equal(resumeCommand('abc', "/home/o'neil/p", 'linux'), `cd '/home/o'\\''neil/p' && claude --resume abc`);
  assert.equal(resumeCommand('abc', 'C:\\work', 'win'), 'cd "C:\\work"; claude --resume abc');
  assert.equal(resumeCommand('abc', null, 'linux'), 'claude --resume abc');
});

test('static files stay inside the client folder', () => {
  assert.equal(path.basename(resolveClientFile('/')), 'index.html');
  assert.ok(resolveClientFile('/js/main.js'));
  assert.ok(resolveClientFile('/vendor/three.module.js'));
  assert.equal(resolveClientFile('/../server/index.js'), null);
  assert.equal(resolveClientFile('/%2e%2e/package.json'), null);
  assert.equal(resolveClientFile('/missing.js'), null);
});

test('OpenRig graph becomes members and delegation edges', () => {
  const node = (id, token, name) => ({ id, type: 'rigNode', data: { resumeToken: token, canonicalSessionName: name, logicalId: id.toUpperCase() } });
  const rig = toRig({ name: 'team' }, {
    nodes: [node('a', 's1', 'lead'), node('b', 's2', 'worker'), { id: 'x', type: 'note', data: {} }],
    edges: [{ source: 'a', target: 'b', label: 'delegates' }, { source: 'a', target: 'x', label: 'ignored' }],
  });
  assert.deepEqual(rig.members.map(m => m.id), ['s1', 's2']);
  assert.deepEqual(rig.edges, [{ from: rig.members[0], to: rig.members[1], kind: 'delegates' }]);
});

test('Windows process list parses pid -> start time', () => {
  const map = parseWindowsProcesses('123,1000\r\n\n456,2000\nbroken\n');
  assert.deepEqual([...map], [[123, '1000'], [456, '2000']]);
});
