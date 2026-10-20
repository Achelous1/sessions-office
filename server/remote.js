// Remote sessions: Remote Control sessions running on other PCs ("bridge") and claude.ai/code cloud sessions.
// Each becomes a session summary like the local ones, plus a `workspace` that decides which office it sits in.
const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('./anthropic-api');
const { chatFromEntries, activityOf } = require('./transcripts');
const { SHOW_REMOTE, SETTINGS_FILE, MAX_CLOUD_SESSIONS } = require('./config');

const PAGE_SIZE = 50, MAX_PAGES = 4;
const CACHE_MS = 5000;
const CHAT_LIMIT = 300;
// What busy remote sessions are doing (shells, subagents, last tool) costs one events request per session,
// so it is only fetched for sessions that are working, every ACTIVITY_MS, a few at a time.
const ACTIVITY_MS = 15000, ACTIVITY_EVENTS = 100, ACTIVITY_CONCURRENCY = 4;
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
// Status fields come as enum names ("SESSION_STATUS_BUCKET_WORKING") or as plain words ("working", "running"),
// depending on the endpoint; both are read as the plain word.
const enumWord = value => typeof value === 'string' ? value.toLowerCase().replace(/^session_status_(bucket_)?/, '') : null;
const STATUS_FIELDS = ['status', 'session_status', 'status_bucket', 'worker_status', 'connection_status'];

function statusOf(session) {
  const bucket = enumWord(session.status_bucket), worker = enumWord(session.worker_status), state = enumWord(session.session_status);
  if (bucket === 'blocked' || worker === 'requires_action') return 'waiting';
  // working right now wins over the summary of the previous turn
  if (bucket === 'working' || worker === 'running' || (!bucket && !worker && state === 'running')) return 'busy';
  const summary = session.post_turn_summary ?? session.external_metadata?.post_turn_summary;
  if (summary?.status_category === 'need_input' || summary?.needs_action) return 'waiting';
  return 'idle';
}

const isArchived = s => enumWord(s.session_status) === 'archived' || enumWord(s.status) === 'archived';
// a bridge session only lives while its PC holds the connection; a cloud one until it is archived
const isLive = s => !isArchived(s) && (s.environment_kind !== 'bridge' || enumWord(s.connection_status) === 'connected');

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
    apiStatus: Object.fromEntries(STATUS_FIELDS.filter(f => s[f] != null).map(f => [f, s[f]])), // as the API sent it, for /api/remote
  };
}

// ---------- on / off ----------
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
let enabled = readSettings().remote ?? SHOW_REMOTE;

// Off: no request goes to the API at all, and the remote employees leave on the next poll.
function setRemoteEnabled(on) {
  enabled = !!on;
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), remote: enabled }));
  } catch {}
  Object.assign(cache, { at: 0, data: [], error: null });
  activity.clear();
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
    const sessions = selectLive(await fetchAll());
    if (enabled) Object.assign(cache, { data: sessions, error: null }); // switched off meanwhile: drop it
  } catch (e) {
    cache.error = e.message; // keep showing the last good list
  }
  Object.assign(cache, { at: Date.now(), refreshing: null });
}

// ---------- activity of busy sessions ----------
const activity = new Map(); // session id -> { at, shell, subagents, lastTool, lastUser }
let activityRefreshing = null;

async function refreshActivity(sessions) {
  const queue = [...sessions];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const events = (await api.listEvents(s.id, ACTIVITY_EVENTS)).data ?? [];
        activity.set(s.id, { at: Date.now(), ...activityOf(entriesOfEvents(events)) });
      } catch {
        activity.set(s.id, { ...activity.get(s.id), at: Date.now() }); // keep the last known, retry later
      }
    }
  };
  await Promise.all(Array.from({ length: ACTIVITY_CONCURRENCY }, worker));
  activityRefreshing = null;
}

function updateActivity(sessions) {
  const busy = sessions.filter(s => s.status === 'busy');
  const busyIds = new Set(busy.map(s => s.id));
  for (const id of activity.keys()) if (!busyIds.has(id)) activity.delete(id); // idle again: nothing running
  const stale = busy.filter(s => Date.now() - (activity.get(s.id)?.at ?? 0) >= ACTIVITY_MS);
  if (stale.length) activityRefreshing ??= refreshActivity(stale);
}

const withActivity = s => {
  const { at, ...known } = activity.get(s.id) ?? {};
  return at ? { ...s, ...known } : s;
};

// Never waits on the network: returns the last list and refreshes it in the background, so a slow or
// unreachable API can't hold up the local office. Remote sessions show up from the second poll on.
function listRemoteSessions() {
  if (!enabled) return [];
  if (Date.now() - cache.at >= CACHE_MS) cache.refreshing ??= refresh();
  updateActivity(cache.data);
  return cache.data.map(withActivity);
}

// on/off, the last error, and each session's raw status fields next to how they were read (to check the mapping)
const remoteStatus = () => ({
  enabled, error: enabled ? cache.error : null,
  sessions: cache.data.map(s => ({ title: s.title, status: s.status, api: s.apiStatus })),
});

const isRemoteId = id => cache.data.some(s => s.id === id);

// ---------- one session ----------
// Events (newest first) wrap transcript-like payloads: { payload: { type: 'user' | 'assistant', message }, created_at }
const entriesOfEvents = events => [...events].reverse()
  .map(e => ({ ...(e.payload ?? e), timestamp: e.payload?.timestamp ?? e.created_at }))
  .filter(entry => entry.type === 'user' || entry.type === 'assistant');

const chatOfEvents = events => chatFromEntries(entriesOfEvents(events)).chat;

async function remoteSessionDetail(id) {
  const listed = cache.data.find(s => s.id === id);
  if (!listed) return null;
  const events = (await api.listEvents(id, CHAT_LIMIT)).data ?? [];
  return { ...withActivity(listed), chat: chatOfEvents(events) };
}

async function archiveRemoteSession(id) {
  await api.archiveSession(id);
  cache.data = cache.data.filter(s => s.id !== id); // gone right away, before the next refresh confirms it
  cache.at = 0;
}

module.exports = { listRemoteSessions, remoteStatus, setRemoteEnabled, isRemoteId, remoteSessionDetail, archiveRemoteSession, selectLive, chatOfEvents };
