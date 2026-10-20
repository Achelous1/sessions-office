// Minimal client for the claude.ai sessions API that Remote Control and claude.ai/code use.
// It is not a documented public API: requests reuse Claude Code's own login (OAuth token) and may break
// when Anthropic changes it. Nothing is sent anywhere but api.anthropic.com.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { REMOTE_API_URL } = require('./config');

const REQUEST_TIMEOUT_MS = 8000;
const KEYCHAIN_SERVICE = 'Claude Code-credentials'; // macOS stores the login in the keychain instead of a file

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function readCredentials() {
  const file = readJson(path.join(os.homedir(), '.claude', '.credentials.json'));
  if (file) return file;
  if (process.platform !== 'darwin') return null;
  try {
    return JSON.parse(execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', timeout: 3000 }));
  } catch {
    return null;
  }
}

// { token, orgId } or { error } explaining what is missing
function loadLogin() {
  const credentials = readCredentials();
  const oauth = credentials?.claudeAiOauth;
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || oauth?.accessToken;
  if (!token) return { error: 'Claude Code 로그인 정보를 찾지 못했습니다' };
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && oauth?.expiresAt && oauth.expiresAt < Date.now()) {
    return { error: '로그인 토큰이 만료되었습니다. Claude Code를 한 번 실행하면 갱신됩니다' };
  }
  const orgId = readJson(path.join(os.homedir(), '.claude.json'))?.oauthAccount?.organizationUuid ?? credentials?.organizationUuid;
  return { token, orgId };
}

async function request(method, urlPath, body) {
  const login = loadLogin();
  if (login.error) throw new Error(login.error);
  const headers = {
    authorization: `Bearer ${login.token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-client-platform': 'web_claude_ai',
    'content-type': 'application/json',
  };
  if (login.orgId) headers['x-organization-uuid'] = login.orgId;
  const res = await fetch(REMOTE_API_URL + urlPath, {
    method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok && !(method === 'POST' && res.status === 409)) throw new Error(`${method} ${urlPath}: HTTP ${res.status}`); // 409 = already archived
  return res.status === 204 ? null : res.json();
}

const listSessions = ({ limit, cursor }) =>
  request('GET', `/v1/code/sessions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

const getSession = id => request('GET', `/v1/code/sessions/${encodeURIComponent(id)}`);

// newest first
const listEvents = (id, limit) => request('GET', `/v1/code/sessions/${encodeURIComponent(id)}/events?limit=${limit}&sort_order=desc`);

const archiveSession = id => request('POST', `/v1/code/sessions/${encodeURIComponent(id)}/archive`, {});

module.exports = { listSessions, getSession, listEvents, archiveSession };
