// Live sessions (a session file whose process is still running) and past ones (transcripts without a process).
const fs = require('fs');
const path = require('path');
const { SHOW_SDK, SOURCES } = require('./config');
const { isAlive } = require('./processes');
const { findTranscript, parseTranscript } = require('./transcripts');

const CHAT_LIMIT = 300;
const HISTORY_LIMIT = 60;
const LAST_USER_PREVIEW = 200;
// Newer Claude Code marks finished subagents; older builds never do, so "still writing lately" covers those.
// The mtime heuristic can drop an agent that thinks for longer than this without writing.
const SUBAGENT_IDLE_MS = 180000;

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const transcriptOf = session => findTranscript(path.join(session.src.dir, 'projects'), session.cwd, session.sessionId);

function listLiveSessions() {
  const sessions = [];
  for (const src of SOURCES) {
    const dir = path.join(src.dir, 'sessions');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      let session;
      try { session = readJson(path.join(dir, file)); } catch { continue; }
      if (!session.sessionId) continue;
      session.src = src;
      if (!isAlive(session)) continue;
      if (!SHOW_SDK && session.entrypoint === 'sdk-cli') continue;
      sessions.push(session);
    }
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

const findLiveSession = id => listLiveSessions().find(s => s.sessionId === id);

// Running subagents live next to the transcript: <project>/<sessionId>/subagents/agent-*.meta.json (+ .jsonl).
function runningSubagents(transcript) {
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  if (!fs.existsSync(dir)) return [];
  const agents = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.meta.json')) continue;
    try {
      const meta = readJson(path.join(dir, file));
      const log = path.join(dir, file.replace('.meta.json', '.jsonl'));
      if (meta.finished === true || !fs.existsSync(log) || Date.now() - fs.statSync(log).mtimeMs > SUBAGENT_IDLE_MS) continue;
      agents.push({ type: meta.agentType, description: meta.description });
    } catch {}
  }
  return agents;
}

const lastOfRole = (chat, role) => chat.findLast(m => m.role === role);

function summarize(session) {
  const transcript = transcriptOf(session);
  const parsed = transcript ? parseTranscript(transcript) : { title: null, turns: 0, chat: [] };
  return {
    id: session.sessionId, pid: session.pid, name: session.name, title: parsed.title, cwd: session.cwd,
    status: session.status, entrypoint: session.entrypoint, host: session.src.host, startedAt: session.startedAt,
    turns: parsed.turns,
    lastUser: lastOfRole(parsed.chat, 'user'),
    lastAnswer: lastOfRole(parsed.chat, 'assistant'),
    lastTool: lastOfRole(parsed.chat, 'tool'),
    subagents: transcript ? runningSubagents(transcript) : [],
    shell: parsed.shell ?? 0,
  };
}

function sessionDetail(session) {
  const transcript = transcriptOf(session);
  return { ...summarize(session), chat: transcript ? parseTranscript(transcript).chat.slice(-CHAT_LIMIT) : [] };
}

// A ready-to-paste command that reopens the session in its own working directory.
function resumeCommand(id, cwd, host) {
  if (!cwd) return `claude --resume ${id}`;
  const cd = host === 'win' ? `cd "${cwd}"; ` : `cd '${cwd.replace(/'/g, `'\\''`)}' && `;
  return `${cd}claude --resume ${id}`;
}

function pastTranscripts(liveIds) {
  const files = [];
  for (const src of SOURCES) {
    const projects = path.join(src.dir, 'projects');
    if (!fs.existsSync(projects)) continue;
    for (const project of fs.readdirSync(projects)) {
      const dir = path.join(projects, project);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        const id = name.slice(0, -'.jsonl'.length);
        if (!name.endsWith('.jsonl') || liveIds.has(id)) continue;
        const file = path.join(dir, name);
        files.push({ file, src, id, mtime: fs.statSync(file).mtimeMs });
      }
    }
  }
  return files;
}

// Past sessions, newest first. Parsing is cached by mtime, so only the first call is slow.
function listHistory(limit = HISTORY_LIMIT) {
  const liveIds = new Set(listLiveSessions().map(s => s.sessionId));
  return pastTranscripts(liveIds)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .flatMap(({ file, src, id, mtime }) => {
      const parsed = parseTranscript(file);
      if (!parsed.turns) return []; // empty / aborted sessions are not worth resuming
      return [{
        id, host: src.host, name: parsed.name, title: parsed.title, cwd: parsed.cwd, turns: parsed.turns, mtime,
        lastUser: lastOfRole(parsed.chat, 'user')?.text.slice(0, LAST_USER_PREVIEW),
        command: resumeCommand(id, parsed.cwd, src.host),
      }];
    });
}

module.exports = { listLiveSessions, findLiveSession, summarize, sessionDetail, listHistory, resumeCommand };
