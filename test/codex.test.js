const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCodexTranscript, openThreadIds, createCodexReader } = require('../server/codex');

const ID = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const PAST = '33333333-3333-4333-8333-333333333333';
const ts = '2026-10-20T10:00:00Z';
const entry = (type, payload) => ({ type, timestamp: ts, payload });
const meta = (id = ID, extra = {}) => entry('session_meta', { id, cwd: "/work/o'neil", source: 'vscode', timestamp: ts, ...extra });
const event = (type, extra = {}) => entry('event_msg', { type, ...extra });
const message = (role, text) => entry('response_item', { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
const call = (name, id, args = {}) => entry('response_item', { type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const result = id => entry('response_item', { type: 'function_call_output', call_id: id, output: 'ok' });
const jsonl = records => records.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n';

test('Codex transcript uses visible messages once, never system prompts or reasoning', () => {
  const parsed = parseCodexTranscript(jsonl([
    meta(), event('task_started', { turn_id: 't1' }),
    message('developer', 'private instructions'),
    message('user', '# AGENTS.md instructions\n<INSTRUCTIONS>rules</INSTRUCTIONS>'),
    message('user', 'fix the parser'),
    event('user_message', { message: 'fix the parser' }),
    event('item_completed', { item: { type: 'UserMessage', content: [{ type: 'text', text: 'fix the parser' }] } }),
    message('assistant', 'working'),
    event('agent_message', { message: 'working' }),
    entry('response_item', { type: 'reasoning', summary: [{ text: 'hidden' }] }),
    call('exec_command', 'sh', { cmd: 'npm test' }), 'broken json',
  ]));
  assert.equal(parsed.id, ID);
  assert.equal(parsed.turns, 1);
  assert.equal(parsed.status, 'busy');
  assert.equal(parsed.shell, 1);
  assert.deepEqual(parsed.chat.map(m => [m.role, m.text, m.turn]), [
    ['user', 'fix the parser', 1], ['assistant', 'working', 1], ['tool', 'exec_command: npm test', 1],
  ]);
});

test('Codex turns stay busy after commentary, wait for input, and clear activity on completion or abort', () => {
  const running = [meta(), event('task_started', { turn_id: 't' }), message('assistant', 'still working')];
  assert.equal(parseCodexTranscript(jsonl(running)).status, 'busy');
  const waiting = [...running, call('request_user_input', 'ask')];
  assert.equal(parseCodexTranscript(jsonl(waiting)).status, 'waiting');
  assert.equal(parseCodexTranscript(jsonl([...waiting, result('ask')])).status, 'busy');
  for (const end of ['task_complete', 'turn_aborted']) {
    const parsed = parseCodexTranscript(jsonl([...waiting, call('exec_command', 'sh'), event(end, { turn_id: 't' })]));
    assert.equal(parsed.status, 'idle');
    assert.equal(parsed.shell, 0);
  }
});

test('yielded Codex commands keep terminal activity until their process exits', () => {
  const running = [
    meta(), event('task_started'), call('exec_command', 'sh', { cmd: 'npm start' }),
    entry('response_item', { type: 'function_call_output', call_id: 'sh', output: 'Process running with session ID 1234' }),
    event('task_complete'),
  ];
  assert.equal(parseCodexTranscript(jsonl(running)).shell, 1);
  const stopped = [...running, event('task_started'), call('write_stdin', 'poll', { session_id: 1234 }),
    entry('response_item', { type: 'function_call_output', call_id: 'poll', output: 'Process exited with code 0' })];
  assert.equal(parseCodexTranscript(jsonl(stopped)).shell, 0);
  assert.equal(parseCodexTranscript(jsonl([...running, event('turn_aborted')])).shell, 0);
});

test('Codex old event-only transcripts and custom tool calls remain readable', () => {
  const parsed = parseCodexTranscript(jsonl([
    meta(), event('task_started'), event('user_message', { message: 'hello' }),
    event('agent_message', { message: 'hello back' }), event('task_complete'),
  ]));
  assert.deepEqual(parsed.chat.map(m => m.text), ['hello', 'hello back']);
  assert.equal(parsed.turns, 1);
  const custom = parseCodexTranscript(jsonl([
    meta(), event('task_started'),
    entry('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c', input: 'await tools.exec_command({cmd: "ls"})' }),
    entry('response_item', { type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'input_text', text: 'done' }] }),
  ]));
  assert.equal(custom.chat.length, 1);
  assert.match(custom.chat[0].text, /^exec:/);
  assert.equal(custom.shell, 0);
});

test('forked Codex subagents keep their own identity when parent metadata is replayed', () => {
  const parsed = parseCodexTranscript(jsonl([
    meta(CHILD, { parent_thread_id: ID, source: { subagent: 'worker' } }),
    meta(ID), event('task_started'), message('user', 'child task'),
  ]));
  assert.equal(parsed.id, CHILD);
  assert.equal(parsed.parentId, ID);
  assert.equal(parsed.isSubagent, true);
});

test('Codex reader tolerates split UTF-8 records and a complete final line without a newline', async t => {
  const { dir, write } = fixture(t);
  const file = write(ID, [meta(), event('task_started')]);
  const bytes = Buffer.from(JSON.stringify(message('user', '한글 메시지')));
  const split = bytes.indexOf(Buffer.from('한')) + 1;
  fs.appendFileSync(file, bytes.subarray(0, split));
  const reader = createCodexReader({ dir, readOpenThreads: async () => new Set([ID]), cacheMs: 0 });
  assert.equal((await reader.list())[0].turns, 0);
  fs.appendFileSync(file, bytes.subarray(split));
  assert.equal((await reader.detail('codex-' + ID)).chat[0].text, '한글 메시지');
  fs.appendFileSync(file, '\n' + jsonl([message('assistant', '완료')]));
  const detail = await reader.detail('codex-' + ID);
  assert.equal(detail.turns, 1);
  assert.deepEqual(detail.chat.map(m => m.text), ['한글 메시지', '완료']);
});

test('a malformed content block does not hide a Codex session or the messages after it', async t => {
  const { dir, write } = fixture(t);
  write(ID, [meta(), message('user', 'before'),
    entry('response_item', { type: 'message', role: 'assistant', content: [null, 3, { type: 'output_text', text: 42 }] }),
    message('assistant', 'after')]);
  const reader = createCodexReader({ dir, readOpenThreads: async () => new Set([ID]) });
  const detail = await reader.detail('codex-' + ID);
  assert.deepEqual(detail.chat.map(m => m.text), ['before', 'after']);
});

test('large history reads retain session identity and recent messages with an explicit partial turn count', async t => {
  const { dir, write } = fixture(t);
  write(PAST, [meta(PAST), message('user', 'old question'),
    entry('response_item', { type: 'function_call_output', call_id: 'big', output: 'x'.repeat(512 * 1024) }),
    message('user', 'latest question'), event('task_complete')]);
  const reader = createCodexReader({ dir, readOpenThreads: async () => new Set() });
  const [past] = await reader.history();
  assert.equal(past.lastUser, 'latest question');
  assert.equal(past.turnsApproximate, true);
  assert.equal(past.turns, 1);
  assert.match(past.command, /codex resume 33333333/);
});

test('open Codex threads come from matching files held by Codex, not stale lock files or another process', () => {
  assert.deepEqual([...openThreadIds([
    'p123', 'ccodex', `n/codex/thread-writer-locks/${ID}.lock`,
    `n/elsewhere/thread-writer-locks/${PAST}.lock`,
    'p456', 'cnode', `n/codex/thread-writer-locks/${PAST}.lock`,
    'p789', 'ccodex', `n/codex/sessions/2026/10/20/rollout-date-${CHILD}.jsonl`,
  ].join('\n'), '/codex')], [ID, CHILD]);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = path.join(dir, 'sessions', '2026', '10', '20');
  fs.mkdirSync(logs, { recursive: true });
  const write = (id, records) => {
    const file = path.join(logs, `rollout-2026-10-20T10-00-00-${id}.jsonl`);
    fs.writeFileSync(file, jsonl(records));
    return file;
  };
  return { dir, write };
}

test('Codex reader lists live parents with child activity, detail, and quoted history commands', async t => {
  const { dir, write } = fixture(t);
  write(ID, [meta(), event('task_started'), message('user', 'build it')]);
  write(CHILD, [meta(CHILD, { parent_thread_id: ID, source: { subagent: 'worker' } }), event('task_started')]);
  write(PAST, [meta(PAST), message('user', 'old task'), event('task_complete')]);
  fs.writeFileSync(path.join(dir, 'session_index.jsonl'), jsonl([{ id: ID, thread_name: 'Custom title' }]));
  const reader = createCodexReader({ dir, readOpenThreads: async () => new Set([ID, CHILD]), cacheMs: 0 });
  const list = await reader.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'codex-' + ID);
  assert.equal(list[0].provider, 'codex');
  assert.equal(list[0].title, 'Custom title');
  assert.equal(list[0].canTerminate, false);
  assert.equal(list[0].subagents.length, 1);
  assert.equal((await reader.detail(list[0].id)).chat[0].text, 'build it');
  assert.equal(await reader.detail('../auth.json'), null);
  const past = await reader.history();
  assert.equal(past.length, 1);
  assert.equal(past[0].command, `cd '/work/o'\\''neil' && codex resume ${PAST}`);
});

test('Codex polling picks up appended records, closed threads and truncated files', async t => {
  const { dir, write } = fixture(t);
  const file = write(ID, [meta(), event('task_started'), message('user', 'first')]);
  let open = new Set([ID]);
  const reader = createCodexReader({ dir, readOpenThreads: async () => open, cacheMs: 0 });
  assert.equal((await reader.list())[0].status, 'busy');
  fs.appendFileSync(file, jsonl([message('assistant', 'done'), event('task_complete')]));
  assert.equal((await reader.list())[0].status, 'idle');
  assert.equal((await reader.detail('codex-' + ID)).chat.at(-1).text, 'done');
  write(ID, [meta(), message('user', 'reset'), event('task_complete')]);
  assert.equal((await reader.list())[0].turns, 1);
  assert.equal((await reader.detail('codex-' + ID)).chat[0].text, 'reset');
  open = new Set();
  assert.deepEqual(await reader.list(), []);
  assert.equal((await reader.history()).length, 1);
});

test('missing Codex installation is harmless; unavailable process detection is explicitly approximate', async t => {
  const { dir, write } = fixture(t);
  const missing = createCodexReader({ dir: path.join(dir, 'missing'), readOpenThreads: async () => null });
  assert.deepEqual(await missing.list(), []);
  assert.deepEqual(await missing.history(), []);
  write(ID, [meta(), event('task_started'), message('user', 'recent')]);
  const stale = write(PAST, [meta(PAST), event('task_started'), message('user', 'stale')]);
  fs.utimesSync(stale, new Date(0), new Date(0));
  const reader = createCodexReader({ dir, readOpenThreads: async () => null, cacheMs: 0 });
  const list = await reader.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'unknown');
  assert.match(list[0].statusNote, /최근|확인/);
});
