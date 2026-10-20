const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-')); // remembered hosts go here
const { selectLive, chatOfEvents } = require('../server/remote');

const session = (id, extra) => ({
  id, title: id, created_at: '2026-10-01T00:00:00Z', session_status: 'SESSION_STATUS_IDLE',
  status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED', environment_kind: 'anthropic_cloud', ...extra,
});
const bridge = (id, extra) => session(id, { environment_kind: 'bridge', connection_status: 'connected', ...extra });

test('live remote sessions are grouped into workspaces', () => {
  const live = selectLive([
    session('cloud-1', { session_status: 'SESSION_STATUS_RUNNING', status_bucket: 'SESSION_STATUS_BUCKET_WORKING' }),
    session('cloud-old', { session_status: 'SESSION_STATUS_ARCHIVED' }),
    bridge('pc-auto', { title: 'build-box-happy-otter', tags: ['remote-control-auto'] }),
    bridge('pc-offline', { title: 'build-box-quiet-fox', tags: ['remote-control-auto'], connection_status: 'disconnected' }),
    bridge('pc-renamed', { title: 'Fix the login bug' }),
  ]);
  const byId = Object.fromEntries(live.map(s => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['cloud-1', 'pc-auto', 'pc-renamed']);
  assert.deepEqual(byId['cloud-1'].workspace, { id: 'cloud', kind: 'cloud', name: '클라우드' });
  assert.equal(byId['cloud-1'].status, 'busy');
  assert.deepEqual(byId['pc-auto'].workspace, { id: 'remote:build-box', kind: 'remote', name: 'build-box' });
  assert.equal(byId['pc-renamed'].workspace.id, 'remote:?');
});

test('a bridge session keeps its PC after being renamed', () => {
  selectLive([bridge('pc-x', { title: 'lab-pc-brave-lion', tags: ['remote-control-auto'] })]);
  const [renamed] = selectLive([bridge('pc-x', { title: 'Refactor the parser', tags: ['remote-control-auto'] })]);
  assert.equal(renamed.workspace.name, 'lab-pc');
});

test('waiting status comes from the post-turn summary', () => {
  const [s] = selectLive([session('c', { post_turn_summary: { status_category: 'need_input', status_detail: 'ready to push?' }, updated_at: 'T' })]);
  assert.equal(s.status, 'waiting');
  assert.deepEqual(s.lastAnswer, { role: 'assistant', text: 'ready to push?', ts: 'T' });
});

test('this PC\'s own Remote Control sessions are left to the local office', () => {
  const host = os.hostname().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert.deepEqual(selectLive([bridge('mine', { title: `${host}-shy-bird`, tags: ['remote-control-auto'] })]), []);
});

test('cloud sessions are capped to the most recent', () => {
  const many = Array.from({ length: 30 }, (_, i) => session('c' + i, { created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
  const live = selectLive(many);
  assert.equal(live.length, 24);
  assert.ok(!live.some(s => s.id === 'c0'));
});

test('events become a chat log in time order', () => {
  const chat = chatOfEvents([ // newest first, like the API
    { created_at: '2', payload: { type: 'assistant', message: { content: [{ type: 'text', text: 'hi there' }] } } },
    { created_at: '1.5', payload: { type: 'system', subtype: 'init' } },
    { created_at: '1', payload: { type: 'user', message: { content: 'hello' } } },
  ]);
  assert.deepEqual(chat.map(m => [m.role, m.text, m.ts, m.turn]), [['user', 'hello', '1', 1], ['assistant', 'hi there', '2', 1]]);
});
