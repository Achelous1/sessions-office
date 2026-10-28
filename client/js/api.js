// Calls to the local Session Office server.
const getJson = async url => (await fetch(url)).json();

export const fetchSessions = () => getJson('/api/sessions');
export const fetchRigs = () => getJson('/api/rigs');
export const fetchHistory = () => getJson('/api/history');
export const fetchRemoteStatus = () => getJson('/api/remote'); // { enabled, error }

// Turns reading remote sessions on or off; returns the new { enabled, error }.
export async function setRemoteEnabled(enabled) {
  const res = await fetch('/api/remote', { method: 'POST', headers: { 'x-office': '1', 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

// null when the session is gone
export async function fetchSession(id) {
  const res = await fetch('/api/session/' + id);
  return res.ok ? res.json() : null;
}

// git changes in the session's working directory (see server/diff.js): view = 'worktree' | 'all' | commit sha,
// base = branch to compare against ('' for none, undefined to guess). { files, commits, ... } or { error }
export async function fetchDiff(id, { view, base } = {}) {
  const query = new URLSearchParams({ view: view ?? 'worktree' });
  if (base !== undefined) query.set('base', base);
  return (await fetch(`/api/session/${id}/diff?${query}`)).json();
}

// Terminates the session's process. Throws with the server's reason on failure.
export async function fireSession(id) {
  // the custom header makes the request non-simple, so other websites can't send it (see server/routes.js)
  const res = await fetch(`/api/session/${id}/fire`, { method: 'POST', headers: { 'x-office': '1' } });
  if (!res.ok) throw new Error((await res.json()).error);
}
