// HTTP API + static client.
//   GET  /api/sessions          live sessions (summaries): local, then remote PCs and cloud
//   GET  /api/session/:id       one live session with its chat log
//   POST /api/session/:id/fire  terminate a local session / archive a remote one
//   GET  /api/history           past local sessions with a resume command
//   GET  /api/rigs              OpenRig teams and delegation edges
//   GET  /api/remote            whether remote sessions are on, and the last error reading them
const { listLiveSessions, findLiveSession, summarize, sessionDetail, listHistory } = require('./sessions');
const { listRemoteSessions, remoteStatus, isRemoteId, remoteSessionDetail, archiveRemoteSession } = require('./remote');
const { terminate } = require('./processes');
const { listRigs } = require('./rigs');
const { serveStatic } = require('./static');

const SESSION_ROUTE = /^\/api\/session\/([\w-]+)$/;
const FIRE_ROUTE = /^\/api\/session\/([\w-]+)\/fire$/;

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const listAllSessions = () => [...listLiveSessions().map(summarize), ...listRemoteSessions()];

async function fireSession(req, res, id) {
  // the custom header forces a CORS preflight we never answer, so other websites can't fire sessions
  if (req.method !== 'POST' || req.headers['x-office'] !== '1') return sendJson(res, { error: 'forbidden' }, 403);
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
  const session = findLiveSession(id);
  if (session) return sendJson(res, sessionDetail(session));
  const remote = await remoteSessionDetail(id);
  if (remote) return sendJson(res, remote);
  sendJson(res, { error: 'not found' }, 404);
}

async function handleRequest(req, res) {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/sessions') return sendJson(res, listAllSessions());
    if (url === '/api/history') return sendJson(res, listHistory());
    if (url === '/api/rigs') return sendJson(res, await listRigs());
    if (url === '/api/remote') return sendJson(res, remoteStatus());
    const fire = url.match(FIRE_ROUTE);
    if (fire) return await fireSession(req, res, fire[1]);
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
