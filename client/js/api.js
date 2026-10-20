// Calls to the local Session Office server.
const getJson = async url => (await fetch(url)).json();

export const fetchSessions = () => getJson('/api/sessions');
export const fetchRigs = () => getJson('/api/rigs');
export const fetchHistory = () => getJson('/api/history');
export const fetchRemoteStatus = () => getJson('/api/remote'); // { enabled, error }

// null when the session is gone
export async function fetchSession(id) {
  const res = await fetch('/api/session/' + id);
  return res.ok ? res.json() : null;
}

// Terminates the session's process. Throws with the server's reason on failure.
export async function fireSession(id) {
  // the custom header makes the request non-simple, so other websites can't send it (see server/routes.js)
  const res = await fetch(`/api/session/${id}/fire`, { method: 'POST', headers: { 'x-office': '1' } });
  if (!res.ok) throw new Error((await res.json()).error);
}
