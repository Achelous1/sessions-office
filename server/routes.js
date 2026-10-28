// HTTP API + static client.
//   GET  /api/sessions          live sessions (summaries): local, then remote PCs and cloud
//   GET  /api/session/:id       one live session with its chat log
//   GET  /api/session/:id/diff  uncommitted git changes in a live local session's working directory
//   POST /api/session/:id/fire  terminate a local session / archive a remote one
//   GET  /api/history           past local sessions with a resume command
//   GET  /api/rigs              OpenRig teams and delegation edges
//   GET  /api/remote            whether remote sessions are on, and the last error reading them
//   POST /api/remote            { enabled } turns reading remote sessions on or off
const { listLiveSessions, findLiveSession, summarize, sessionDetail, listHistory } = require('./sessions');
const { listRemoteSessions, remoteStatus, setRemoteEnabled, isRemoteId, remoteSessionDetail, archiveRemoteSession } = require('./remote');
const { terminate } = require('./processes');
const { listRigs } = require('./rigs');
const { serveStatic } = require('./static');
const { codex } = require('./codex');
const { workingTreeDiff } = require('./diff');

const SESSION_ROUTE = /^\/api\/session\/([\w-]+)$/;
const FIRE_ROUTE = /^\/api\/session\/([\w-]+)\/fire$/;
const DIFF_ROUTE = /^\/api\/session\/([\w-]+)\/diff$/;

// the custom header forces a CORS preflight we never answer, so other websites can't change things
const fromThisPage = req => req.method === 'POST' && req.headers['x-office'] === '1';

const MAX_BODY = 1024;
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function toggleRemote(req, res) {
  if (!fromThisPage(req)) return sendJson(res, { error: 'forbidden' }, 403);
  const { enabled } = await readJsonBody(req);
  if (typeof enabled !== 'boolean') return sendJson(res, { error: 'enabled must be true or false' }, 400);
  setRemoteEnabled(enabled);
  sendJson(res, remoteStatus());
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const listAllSessions = async () => [...listLiveSessions().map(summarize), ...await codex.list(), ...listRemoteSessions()];

async function fireSession(req, res, id) {
  if (!fromThisPage(req)) return sendJson(res, { error: 'forbidden' }, 403);
  // Codex Desktop shares a process across threads; killing it would stop unrelated work.
  if (id.startsWith('codex-')) return sendJson(res, { error: 'Codex 세션은 Codex 앱 또는 CLI에서 종료해 주세요' }, 405);
  const session = findLiveSession(id);
  try {
    if (session) terminate(session);
    else if (isRemoteId(id)) await archiveRemoteSession(id);
    else return sendJson(res, { error: 'not found' }, 404);
  } catch (e) {
    return sendJson(res, { error: e.message }, 409);
  }
  sendJson(res, { ok: true });
}

async function getSession(res, id) {
  if (id.startsWith('codex-')) {
    const session = await codex.detail(id);
    return session ? sendJson(res, session) : sendJson(res, { error: 'not found' }, 404);
  }
  const session = findLiveSession(id);
  if (session) return sendJson(res, sessionDetail(session));
  const remote = await remoteSessionDetail(id);
  if (remote) return sendJson(res, remote);
  sendJson(res, { error: 'not found' }, 404);
}

// Only sessions on this PC: a remote or cloud session's working directory is on another machine.
async function getDiff(res, id) {
  const session = id.startsWith('codex-') ? (await codex.list()).find(s => s.id === id) : findLiveSession(id);
  if (!session) return sendJson(res, { error: isRemoteId(id) ? '원격·클라우드 세션의 변경 사항은 볼 수 없습니다' : 'not found' }, 404);
  sendJson(res, await workingTreeDiff(session.cwd, session.src?.host ?? session.host));
}

async function handleRequest(req, res) {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/sessions') return sendJson(res, await listAllSessions());
    if (url === '/api/history') return sendJson(res, [...listHistory(), ...await codex.history()].sort((a, b) => b.mtime - a.mtime).slice(0, 60));
    if (url === '/api/rigs') return sendJson(res, await listRigs());
    if (url === '/api/remote') return req.method === 'POST' ? await toggleRemote(req, res) : sendJson(res, remoteStatus());
    const fire = url.match(FIRE_ROUTE);
    if (fire) return await fireSession(req, res, fire[1]);
    const diff = url.match(DIFF_ROUTE);
    if (diff) return await getDiff(res, diff[1]);
    const session = url.match(SESSION_ROUTE);
    if (session) return await getSession(res, session[1]);
    if (req.method === 'GET' && serveStatic(req, res, url)) return;
    res.writeHead(404);
    res.end();
  } catch (e) {
    sendJson(res, { error: String(e) }, 500);
  }
}

module.exports = { handleRequest };
