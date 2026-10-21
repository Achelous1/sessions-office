const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('API combines providers, preserves Claude detail/fire, and refuses to terminate Codex', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-routes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const local = require('../server/sessions'), remote = require('../server/remote');
  const processes = require('../server/processes');
  const { codex, createCodexReader } = require('../server/codex');
  const uuid = '11111111-1111-4111-8111-111111111111', id = 'codex-' + uuid;
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sessions', `rollout-date-${uuid}.jsonl`), [
    { type: 'session_meta', payload: { id: uuid, cwd: '/work', timestamp: '2026-10-20T00:00:00Z' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex question' }] } },
  ].map(JSON.stringify).join('\n'));
  const reader = createCodexReader({ dir, readOpenThreads: async () => new Set([uuid]) });
  for (const method of ['list', 'detail', 'history']) t.mock.method(codex, method, reader[method]);
  const claude = { sessionId: 'claude-one', cwd: '/work', src: { dir, host: 'local' }, status: 'idle' };
  t.mock.method(local, 'listLiveSessions', () => [claude]);
  t.mock.method(local, 'findLiveSession', id => id === claude.sessionId ? claude : null);
  t.mock.method(local, 'listHistory', () => [{ id: 'past-claude', mtime: 1, command: 'claude --resume past-claude' }]);
  t.mock.method(remote, 'listRemoteSessions', () => [{ id: 'remote-one', remote: true, status: 'busy' }]);
  t.mock.method(remote, 'isRemoteId', id => id === 'remote-one');
  t.mock.method(remote, 'remoteSessionDetail', async id => id === 'remote-one' ? { id, chat: [] } : null);
  const terminated = [], archived = [];
  t.mock.method(processes, 'terminate', session => terminated.push(session.sessionId));
  t.mock.method(remote, 'archiveRemoteSession', async id => archived.push(id));
  const { handleRequest } = require('../server/routes');
  async function request(url, method = 'GET', headers = {}) {
    let status, body;
    await handleRequest({ url, method, headers }, {
      writeHead(code) { status = code; },
      end(text) { body = JSON.parse(text); },
    });
    return { status, body };
  }
  const list = await request('/api/sessions');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map(s => s.id).sort(), ['claude-one', id, 'remote-one'].sort());
  assert.equal((await request('/api/session/' + id)).body.chat[0].text, 'Codex question');
  assert.equal((await request('/api/session/claude-one')).body.id, 'claude-one');
  assert.equal((await request('/api/session/remote-one')).body.id, 'remote-one');
  assert.equal((await request('/api/session/codex-unknown')).status, 404);
  assert.equal((await request(`/api/session/${id}/fire`, 'POST')).status, 403);
  assert.equal((await request(`/api/session/${id}/fire`, 'POST', { 'x-office': '1' })).status, 405);
  assert.deepEqual(terminated, []);
  assert.equal((await request('/api/session/claude-one/fire', 'POST', { 'x-office': '1' })).status, 200);
  assert.deepEqual(terminated, ['claude-one']);
  assert.equal((await request('/api/session/remote-one/fire', 'POST', { 'x-office': '1' })).status, 200);
  assert.deepEqual(archived, ['remote-one']);
  assert.equal((await request('/api/history')).body[0].command, 'claude --resume past-claude');
});
