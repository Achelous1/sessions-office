// Read-only local Codex adapter. No login, Codex database writes, or process termination.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { SOURCES } = require('./config');

const CODEX_DIR = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROLLOUT = new RegExp(`^rollout-.*-(${UUID})\\.jsonl$`, 'i');
const LOCK = new RegExp(`^(${UUID})\\.lock$`, 'i');
const API_ID = new RegExp(`^codex-(${UUID})$`, 'i');
const CACHE_MS = 2000, RECENT_MS = 15 * 60 * 1000, CHAT_LIMIT = 300;
const HISTORY_BYTES = 256 * 1024;
const LOCAL = { id: 'local', kind: 'local', name: '로컬' };
const SHELL_TOOLS = new Set(['exec_command', 'write_stdin', 'shell', 'shell_command', 'exec']);
const CONTEXT = /^(# AGENTS\.md instructions|<(?:environment_context|permissions instructions|external_codex_apps_open_page|turn_aborted|user_instructions|subagent_notification)[>\s])/;
const textOf = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(b => b && ['input_text', 'output_text', 'text'].includes(b.type) && typeof b.text === 'string').map(b => b.text).join('\n') : '';

function transcriptParser() {
  let meta = {}, status = 'idle';
  const chat = [], eventChat = [], pending = new Map(), background = new Set();
  let turns = 0, eventTurns = 0, hasMessages = false, firstUser = '';
  const push = (target, role, text, ts) => {
    if (typeof text !== 'string' || !text.trim() || (role === 'user' && CONTEXT.test(text.trim()))) return;
    if (role === 'user') {
      if (target === chat) { turns++; firstUser ||= text; } else eventTurns++;
    }
    target.push({ role, text: text.trim(), ts, turn: target === chat ? turns : eventTurns });
    if (target.length > CHAT_LIMIT) target.shift();
  };
  function readLine(line) {
    let e;
    try { e = JSON.parse(line); } catch { return; }
    const p = e?.payload;
    if (!p || typeof p !== 'object') return;
    if (e.type === 'session_meta') {
      if (meta.id) return; // Forked rollouts replay their parent's metadata after their own.
      // Do not retain the large system prompt bundled into session metadata.
      meta = { id: p.id, cwd: p.cwd, timestamp: p.timestamp, parent_thread_id: p.parent_thread_id, source: p.source, originator: p.originator };
      return;
    }
    if (e.type === 'event_msg') {
      if (p.type === 'task_started') { status = 'busy'; pending.clear(); }
      if (p.type === 'task_complete' || p.type === 'turn_aborted') { status = 'idle'; pending.clear(); }
      if (p.type === 'turn_aborted') background.clear();
      // Older builds also emit these events. Prefer response_item messages when both are present.
      if (p.type === 'user_message') push(eventChat, 'user', p.message, e.timestamp);
      if (p.type === 'agent_message') push(eventChat, 'assistant', p.message, e.timestamp);
      return;
    }
    if (e.type !== 'response_item') return;
    if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
      hasMessages = true;
      push(chat, p.role, textOf(p.content), e.timestamp);
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const name = String(p.name || 'tool');
      const shortName = name.split('.').at(-1);
      let input = p.arguments ?? p.input ?? '';
      try { input = JSON.parse(input); } catch {}
      const hint = typeof input === 'string' ? input : input?.cmd || input?.command || input?.description || input?.path || '';
      push(chat, 'tool', name + (hint ? ': ' + String(hint).slice(0, 120) : ''), e.timestamp);
      const job = input?.session_id != null ? 'process:' + input.session_id : input?.cell_id ? 'cell:' + input.cell_id : null;
      pending.set(p.call_id, { name: shortName, job });
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const tool = pending.get(p.call_id);
      if (tool?.job) background.delete(tool.job);
      if (tool && (SHELL_TOOLS.has(tool.name) || tool.name === 'wait')) {
        const output = textOf(p.output);
        const processId = /Process running with session ID[: ]+([\w-]+)/i.exec(output)?.[1];
        const cellId = /Script running with cell ID[: ]+([\w-]+)/i.exec(output)?.[1];
        if (processId) background.add('process:' + processId);
        if (cellId) background.add('cell:' + cellId);
        try {
          const result = JSON.parse(output);
          if (result?.session_id != null && result.exit_code == null) background.add('process:' + result.session_id);
        } catch {}
      }
      pending.delete(p.call_id);
    }
  }
  function value() {
    const waiting = [...pending.values()].some(t => t.name === 'request_user_input');
    const messages = hasMessages ? chat : [...eventChat, ...chat].sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(-CHAT_LIMIT);
    const source = meta.source;
    return {
      id: meta.id, cwd: meta.cwd, startedAt: Date.parse(meta.timestamp),
      parentId: meta.parent_thread_id || source?.subagent?.thread_spawn?.parent_thread_id,
      isSubagent: !!source?.subagent, originator: meta.originator,
      status: status === 'busy' && waiting ? 'waiting' : status,
      turns: hasMessages ? turns : eventTurns, chat: messages,
      firstUser: firstUser || eventChat.find(m => m.role === 'user')?.text || '',
      shell: background.size + (status === 'idle' ? 0 : [...pending.values()].filter(t => SHELL_TOOLS.has(t.name) && !background.has(t.job)).length),
    };
  }
  return { readLine, value };
}

function parseCodexTranscript(text) {
  const parser = transcriptParser();
  for (const line of text.split('\n')) parser.readLine(line);
  return parser.value();
}

// A leftover lock file is not proof of a live thread: only files currently held by Codex count.
function openThreadIds(output, dir) {
  const ids = new Set(), locks = path.join(dir, 'thread-writer-locks'), sessions = path.join(dir, 'sessions') + path.sep;
  let codexProcess = false;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) codexProcess = false;
    if (line.startsWith('c')) codexProcess = /^codex(?:$|[- ])/i.test(line.slice(1));
    if (!codexProcess || !line.startsWith('n')) continue;
    const file = line.slice(1);
    const match = path.dirname(file) === locks ? LOCK.exec(path.basename(file))
      : file.startsWith(sessions) ? ROLLOUT.exec(path.basename(file)) : null;
    if (match) ids.add(match[1]);
  }
  return ids;
}

// lsof prints mount warnings (e.g. WSL Docker overlays) even when it simply found no codex process.
const onlyWarnings = stderr => !String(stderr ?? '').split('\n').some(l => l.trim() && !/^(lsof: WARNING:|\s)/.test(l));

function readOpenThreads(dir) {
  if (process.platform === 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    execFile('lsof', ['-nP', '-c', 'codex', '-Fpcn'], { encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (error, out, stderr) => {
      // lsof can return 1 with useful output when some process descriptors cannot be inspected.
      if (out && !error?.killed) return resolve(openThreadIds(out, dir));
      if (!error || (error.code === 1 && onlyWarnings(stderr))) return resolve(new Set());
      resolve(null); // unavailable/denied: show recent activity as unconfirmed, never pretend it is live
    });
  });
}

function rolloutFiles(dir) {
  const files = [];
  function walk(folder, depth) {
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const file = path.join(folder, e.name);
      if (e.isDirectory() && depth < 3 && /^\d+$/.test(e.name)) walk(file, depth + 1);
      else if (e.isFile()) {
        const match = ROLLOUT.exec(e.name);
        if (!match) continue;
        try { files.push({ id: match[1], file, stat: fs.statSync(file) }); } catch {} // writer may move/archive it
      }
    }
  }
  walk(path.join(dir, 'sessions'), 0);
  return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function resumeCommand(id, cwd) {
  const cd = !cwd ? '' : process.platform === 'win32'
    ? `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; `
    : `cd '${cwd.replace(/'/g, `'\\''`)}' && `;
  return `${cd}codex resume ${id}`;
}

function createCodexReader({ dir = CODEX_DIR, readOpenThreads: detect = readOpenThreads, cacheMs = CACHE_MS } = {}) {
  const parsed = new Map(), headers = new Map(), pastCache = new Map();
  let at = -Infinity, refreshing = null, sessions = [], files = [], liveIds = new Set(), names = new Map(), nameStamp = '';
  function read(file) {
    let fd;
    try {
      const { mtimeMs, size, ino } = file.stat;
      let hit = parsed.get(file.file);
      if (hit?.mtimeMs === mtimeMs && hit.size === size && hit.ino === ino) return hit.data;
      if (!hit || hit.ino !== ino || size <= hit.size) {
        hit = { parser: transcriptParser(), offset: 0, partial: '', decoder: new StringDecoder('utf8') };
      }
      fd = fs.openSync(file.file, 'r');
      const buffer = Buffer.alloc(64 * 1024);
      while (hit.offset < size) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - hit.offset), hit.offset);
        if (!count) break;
        hit.offset += count;
        const lines = (hit.partial + hit.decoder.write(buffer.subarray(0, count))).split('\n');
        hit.partial = lines.pop();
        for (const line of lines) hit.parser.readLine(line);
      }
      if (hit.partial.trim()) {
        try {
          JSON.parse(hit.partial); // A complete last record need not have its newline yet.
          hit.parser.readLine(hit.partial);
          hit.partial = '';
        } catch {}
      }
      const data = hit.parser.value();
      if (data.id !== file.id) return null;
      Object.assign(hit, { mtimeMs, size, ino, data });
      parsed.set(file.file, hit);
      return data;
    } catch { return null; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  // Most past rollouts are inherited subagent histories. Their first record identifies their own thread.
  function headerOf(file) {
    let fd;
    try {
      const stamp = `${file.stat.ino}:${file.stat.mtimeMs}:${file.stat.size}`;
      const known = headers.get(file.file);
      if (known?.stamp === stamp) return known.entry;
      fd = fs.openSync(file.file, 'r');
      const buffer = Buffer.alloc(64 * 1024);
      let header = '';
      while (header.length < 1024 * 1024) {
        const count = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        header += buffer.toString('utf8', 0, count);
        const end = header.indexOf('\n');
        if (end < 0) continue;
        const original = JSON.parse(header.slice(0, end)), p = original.payload;
        if (original.type !== 'session_meta' || p?.id !== file.id) return null;
        const entry = { type: 'session_meta', payload: {
          id: p.id, cwd: p.cwd, timestamp: p.timestamp, source: p.source,
          parent_thread_id: p.parent_thread_id, originator: p.originator,
        } };
        headers.set(file.file, { stamp, entry });
        return entry;
      }
    } catch {}
    finally { if (fd !== undefined) fs.closeSync(fd); }
    return null;
  }
  function readPast(file, header) {
    const stamp = `${file.stat.ino}:${file.stat.mtimeMs}:${file.stat.size}`;
    const hit = pastCache.get(file.file);
    if (hit?.stamp === stamp) return hit.data;
    let fd;
    try {
      fd = fs.openSync(file.file, 'r');
      const start = Math.max(0, file.stat.size - HISTORY_BYTES), buffer = Buffer.alloc(Math.min(file.stat.size, HISTORY_BYTES));
      const count = fs.readSync(fd, buffer, 0, buffer.length, start);
      let text = buffer.toString('utf8', 0, count);
      if (start) text = text.slice(text.indexOf('\n') + 1); // omit a truncated record, including a split UTF-8 character
      const data = { ...parseCodexTranscript(JSON.stringify(header) + '\n' + text), turnsApproximate: start > 0 };
      pastCache.set(file.file, { stamp, data });
      return data;
    } catch { return null; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function readNames() {
    try {
      const file = path.join(dir, 'session_index.jsonl'), st = fs.statSync(file);
      const stamp = `${st.mtimeMs}:${st.size}`;
      if (stamp === nameStamp) return;
      const next = new Map();
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        try { const n = JSON.parse(line); if (typeof n.thread_name === 'string') next.set(n.id, n.thread_name); } catch {}
      }
      names = next; nameStamp = stamp;
    } catch {}
  }
  function summary(p, approximate) {
    return {
      id: 'codex-' + p.id, sessionId: p.id, provider: 'codex', canTerminate: false,
      name: p.originator || 'Codex', title: names.get(p.id) || p.firstUser.slice(0, 100) || path.basename(p.cwd || '') || 'Codex',
      cwd: p.cwd, status: approximate ? 'unknown' : p.status,
      statusNote: approximate ? '실행 여부 확인 불가 · 최근 15분 기록 기준' : 'Codex 로그 기준 · 권한 승인 대기는 확인되지 않을 수 있습니다',
      entrypoint: 'codex', host: SOURCES[0].host, workspace: LOCAL, startedAt: p.startedAt,
      turns: p.turns, lastUser: p.chat.findLast(m => m.role === 'user'),
      lastAnswer: p.chat.findLast(m => m.role === 'assistant'), lastTool: p.chat.findLast(m => m.role === 'tool'),
      subagents: [], shell: approximate ? 0 : p.shell,
    };
  }
  async function refresh() {
    files = rolloutFiles(dir);
    const existing = new Set(files.map(f => f.file));
    for (const cache of [parsed, headers, pastCache]) for (const file of cache.keys()) if (!existing.has(file)) cache.delete(file);
    readNames();
    const open = files.length ? await detect(dir) : new Set();
    const approximate = open === null;
    liveIds = open ?? new Set(files.filter(f => Date.now() - f.stat.mtimeMs < RECENT_MS).map(f => f.id));
    const active = files.filter(f => liveIds.has(f.id)).map(read).filter(Boolean);
    for (const [file, hit] of parsed) if (!liveIds.has(hit.data.id)) parsed.delete(file);
    sessions = active.filter(p => !p.isSubagent && !p.parentId).map(p => {
      const s = summary(p, approximate);
      s.subagents = active.filter(child => child.parentId === p.id && child.status !== 'idle')
        .map(child => ({ type: 'Codex', description: names.get(child.id) || child.firstUser.slice(0, 120) || 'subagent' }));
      return s;
    }).sort((a, b) => a.startedAt - b.startedAt);
    at = Date.now();
  }
  async function list() {
    if (Date.now() - at >= cacheMs) {
      refreshing ??= refresh().finally(() => { refreshing = null; });
      await refreshing;
    }
    return sessions;
  }
  async function detail(id) {
    if (!API_ID.test(id)) return null;
    const session = (await list()).find(s => s.id === id);
    if (!session) return null;
    const file = files.find(f => f.id === session.sessionId), p = file && read(file);
    return p ? { ...session, chat: p.chat } : null;
  }
  async function history(limit = 60) {
    await list();
    const result = [];
    const kept = new Set();
    for (const file of files) {
      if (liveIds.has(file.id)) continue;
      const header = headerOf(file);
      if (!header || header.payload.source?.subagent || header.payload.parent_thread_id) continue;
      const p = readPast(file, header);
      if (!p || p.isSubagent || p.parentId || (!p.turns && !p.turnsApproximate)) continue;
      kept.add(file.file);
      const s = summary(p, false);
      result.push({
        id: s.id, provider: 'codex', host: s.host, name: s.name, title: s.title, cwd: s.cwd, turns: s.turns, turnsApproximate: p.turnsApproximate,
        mtime: file.stat.mtimeMs, lastUser: s.lastUser?.text.slice(0, 200), command: resumeCommand(p.id, p.cwd),
      });
      if (result.length >= limit) break;
    }
    for (const file of pastCache.keys()) if (!kept.has(file)) pastCache.delete(file);
    return result;
  }
  return { list, detail, history };
}

module.exports = { CODEX_DIR, parseCodexTranscript, openThreadIds, onlyWarnings, createCodexReader, codex: createCodexReader() };
