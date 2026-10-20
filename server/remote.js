// Remote sessions: Remote Control sessions running on other PCs ("bridge") and claude.ai/code cloud sessions.
// Each becomes a session summary like the local ones, plus a `workspace` that decides which office it sits in.
const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('./anthropic-api');
const { chatFromEntries } = require('./transcripts');
const { SHOW_REMOTE, MAX_CLOUD_SESSIONS } = require('./config');

const PAGE_SIZE = 50, MAX_PAGES = 4;
const CACHE_MS = 5000;
const CHAT_LIMIT = 300;
const HOSTS_FILE = path.join(os.homedir(), '.session-office', 'remote-hosts.json');

const CLOUD = { id: 'cloud', kind: 'cloud', name: '클라우드' };
const UNKNOWN_PC = { id: 'remote:?', kind: 'remote', name: '원격 PC (미확인)' };

// Hostnames as Remote Control writes them into automatic titles: "mac-mini.local" -> "mac-mini-local"
const hostSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const LOCAL_HOST = hostSlug(os.hostname());

// ---------- which PC a bridge session runs on ----------
// The API has no machine field. A Remote Control session started automatically is titled "<host>-<word>-<word>"
// until its first prompt renames it, so the host is read from that title and remembered per session.
const AUTO_TITLE = /^(.+)-[a-z]+-[a-z]+$/;
let knownHosts = null; // session id -> host slug
function hosts() {
  if (!knownHosts) { try { knownHosts = JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8')); } catch { knownHosts = {}; } }
  return knownHosts;
}
function rememberHost(id, host) {
  if (hosts()[id] === host) return;
  knownHosts[id] = host;
  try { fs.mkdirSync(path.dirname(HOSTS_FILE), { recursive: true }); fs.writeFileSync(HOSTS_FILE, JSON.stringify(knownHosts)); } catch {}
}

function hostOf(session) {
  const auto = (session.tags ?? []).includes('remote-control-auto') && AUTO_TITLE.exec(session.title ?? '');
  if (auto) rememberHost(session.id, auto[1]);
  return hosts()[session.id] ?? null;
}

function workspaceOf(session) {
  if (session.environment_kind !== 'bridge') return CLOUD;
  const host = hostOf(session);
  return host ? { id: 'remote:' + host, kind: 'remote', name: host } : UNKNOWN_PC;
}

// ---------- status ----------
function statusOf(session) {
  const summary = session.post_turn_summary ?? session.external_metadata?.post_turn_summary;
  if (session.status_bucket === 'SESSION_STATUS_BUCKET_BLOCKED' || summary?.status_category === 'need_input' || summary?.needs_action) return 'waiting';
  if (session.status_bucket === 'SESSION_STATUS_BUCKET_WORKING' || session.session_status === 'SESSION_STATUS_RUNNING') return 'busy';
  return 'idle';
}

const isArchived = s => s.session_status === 'SESSION_STATUS_ARCHIVED' || s.status === 'archived';
// a bridge session only lives while its PC holds the connection; a cloud one until it is archived
const isLive = s => !isArchived(s) && (s.environment_kind !== 'bridge' || s.connection_status === 'connected');

const repoOf = s => s.session_context?.sources?.find(src => src.git_repository)?.git_repository.url?.replace(/^https:\/\/github\.com\//, '');

function summarize(s) {
  const summary = s.post_turn_summary ?? s.external_metadata?.post_turn_summary;
  const workspace = workspaceOf(s);
  return {
    id: s.id, name: s.title, title: s.title, cwd: repoOf(s) ?? '', status: statusOf(s),
    entrypoint: 'remote', host: workspace.kind, workspace, startedAt: Date.parse(s.created_at),
    turns: s.user_message_count ?? 0,
    lastUser: null,
    // the one-line status a session reports after each turn doubles as its latest "answer" bubble
    lastAnswer: summary?.status_detail ? { role: 'assistant', text: summary.status_detail, ts: s.updated_at ?? s.last_event_at } : null,
    lastTool: null, subagents: [], shell: 0, remote: true,
  };
}

// ---------- listing ----------
async function fetchAll() {
  const sessions = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.listSessions({ limit: PAGE_SIZE, cursor });
    sessions.push(...(res.data ?? []));
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return sessions;
}

// Keeps every live remote PC session, and the most recently active cloud sessions (there can be many).
function selectLive(sessions) {
  const live = sessions.filter(isLive).map(summarize);
  const remote = live.filter(s => s.host === 'remote' && s.workspace.name !== LOCAL_HOST); // this PC's sessions are already local
  const cloud = live.filter(s => s.host === 'cloud').sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_CLOUD_SESSIONS);
  return [...remote, ...cloud].sort((a, b) => a.startedAt - b.startedAt);
}

const cache = { at: 0, data: [], error: null, refreshing: null };

async function refresh() {
  try {
    Object.assign(cache, { data: selectLive(await fetchAll()), error: null });
  } catch (e) {
    cache.error = e.message; // keep showing the last good list
  }
  Object.assign(cache, { at: Date.now(), refreshing: null });
}

// Never waits on the network: returns the last list and refreshes it in the background, so a slow or
// unreachable API can't hold up the local office. Remote sessions show up from the second poll on.
function listRemoteSessions() {
  if (!SHOW_REMOTE) return [];
  if (Date.now() - cache.at >= CACHE_MS) cache.refreshing ??= refresh();
  return cache.data;
}

const remoteStatus = () => ({ enabled: SHOW_REMOTE, error: cache.error });

const isRemoteId = id => cache.data.some(s => s.id === id);

// ---------- one session ----------
// Events (newest first) wrap transcript-like payloads: { payload: { type: 'user' | 'assistant', message }, created_at }
function chatOfEvents(events) {
  const entries = [...events].reverse()
    .map(e => ({ ...(e.payload ?? e), timestamp: e.payload?.timestamp ?? e.created_at }))
    .filter(entry => entry.type === 'user' || entry.type === 'assistant');
  return chatFromEntries(entries).chat;
}

async function remoteSessionDetail(id) {
  const listed = cache.data.find(s => s.id === id);
  if (!listed) return null;
  const events = (await api.listEvents(id, CHAT_LIMIT)).data ?? [];
  return { ...listed, chat: chatOfEvents(events) };
}

async function archiveRemoteSession(id) {
  await api.archiveSession(id);
  cache.data = cache.data.filter(s => s.id !== id); // gone right away, before the next refresh confirms it
  cache.at = 0;
}

module.exports = { listRemoteSessions, remoteStatus, isRemoteId, remoteSessionDetail, archiveRemoteSession, selectLive, chatOfEvents };
