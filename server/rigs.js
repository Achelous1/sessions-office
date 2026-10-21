// OpenRig (optional): who delegates to whom, from the local daemon's graph API. Empty when OpenRig isn't running.
const fs = require('fs');
const { OPENRIG_DAEMON_FILE } = require('./config');

const CACHE_MS = 10000;
const REQUEST_TIMEOUT_MS = 2000;

const getJson = async url => (await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })).json();

// resumeToken is the Claude session id; the session name is a fallback if the token went stale
const memberOf = node => ({ id: node.data.resumeToken, name: node.data.canonicalSessionName, logicalId: node.data.logicalId });

function toRig(rig, graph) {
  const members = new Map(graph.nodes.filter(n => n.type === 'rigNode').map(n => [n.id, memberOf(n)]));
  const edges = graph.edges
    .filter(e => members.has(e.source) && members.has(e.target))
    .map(e => ({ from: members.get(e.source), to: members.get(e.target), kind: e.label }));
  return { name: rig.name, members: [...members.values()], edges };
}

async function fetchRigs() {
  const { port } = JSON.parse(fs.readFileSync(OPENRIG_DAEMON_FILE, 'utf8'));
  const base = `http://127.0.0.1:${port}/api/rigs`;
  const rigs = await getJson(base);
  return Promise.all(rigs.map(async rig => toRig(rig, await getJson(`${base}/${rig.id}/graph`))));
}

const cache = { at: 0, data: [] };
async function listRigs() {
  if (Date.now() - cache.at < CACHE_MS) return cache.data;
  let data = [];
  try { data = await fetchRigs(); } catch {}
  Object.assign(cache, { at: Date.now(), data });
  return data;
}

module.exports = { listRigs, toRig };
