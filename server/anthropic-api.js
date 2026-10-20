// Minimal client for the claude.ai sessions API that Remote Control and claude.ai/code use.
// It is not a documented public API: requests reuse Claude Code's own login (OAuth token) and may break
// when Anthropic changes it. Nothing is sent anywhere but api.anthropic.com.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { REMOTE_API_URL } = require('./config');

const REQUEST_TIMEOUT_MS = 8000;
// macOS keeps the login in the keychain. Reading it from another program pops up an "allow access" dialog,
// so give the person time to answer it, and don't ask again on every poll.
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 60000;
const CREDENTIALS_CACHE_MS = 60000;
const KEYCHAIN_NOT_FOUND = 44; // exit code of `security` when the item doesn't exist

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// `security -w` prints the secret as text, or as hex when it isn't plain ASCII
const decodeSecret = out => /^([0-9a-f]{2})+$/i.test(out) ? Buffer.from(out, 'hex').toString('utf8') : out;

function readKeychain() {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS }, (err, out) => {
      if (err) {
        const reason = err.code === KEYCHAIN_NOT_FOUND ? '키체인에 Claude Code 로그인 항목이 없습니다. Claude Code에서 /login 해 주세요'
          : err.killed ? '키체인 접근 허용 창에 응답이 없었습니다. 창이 뜨면 "항상 허용"을 눌러 주세요'
          : `키체인을 읽지 못했습니다 (security 종료 코드 ${err.code}). 접근 허용 창이 떴다면 "항상 허용"을 눌러 주세요`;
        return reject(new Error(reason));
      }
      try { resolve(JSON.parse(decodeSecret(out.trim()))); } catch { reject(new Error('키체인의 로그인 정보를 해석하지 못했습니다')); }
    });
  });
}

const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const accessTokenOf = oauth => oauth?.accessToken ?? oauth?.access_token;
const hasLogin = stored => !!accessTokenOf(stored?.claudeAiOauth);

// What a credentials store holds, by key name and value type only (never values), to explain a missing login:
// "항목 [claudeAiOauth{refreshToken, expiresAt}]"
function describe(where, stored) {
  if (!stored) return `${where}: 없음`;
  const keys = Object.entries(stored).map(([key, value]) =>
    value && typeof value === 'object' ? `${key}{${Object.keys(value).join(', ')}}` : `${key}(${value === null ? 'null' : typeof value})`);
  return `${where}: 항목 [${keys.join(', ') || '없음'}]`;
}

// The file wins when it holds a claude.ai login; on macOS the keychain is checked too, since the file may only
// carry other logins (MCP servers etc.) while the claude.ai one lives in the keychain.
async function readCredentials() {
  const file = readJson(CREDENTIALS_FILE);
  if (hasLogin(file) || process.platform !== 'darwin') {
    if (hasLogin(file)) return file;
    throw new Error(`claude.ai 계정 로그인 정보가 없습니다 (${describe('~/.claude/.credentials.json', file)})`);
  }
  const keychain = await readKeychain();
  if (hasLogin(keychain)) return keychain;
  throw new Error(`claude.ai 계정 로그인 정보가 없습니다 (${describe('키체인', keychain)} / ${describe('~/.claude/.credentials.json', file)}). API 키로 로그인했다면 원격 세션을 볼 수 없습니다`);
}

// One read at a time, remembered for a minute (failures too, so a denied dialog doesn't pop up every poll).
const credentialsCache = { at: 0, value: null, error: null, pending: null };
async function credentials() {
  if (Date.now() - credentialsCache.at < CREDENTIALS_CACHE_MS) {
    if (credentialsCache.error) throw credentialsCache.error;
    return credentialsCache.value;
  }
  credentialsCache.pending ??= readCredentials()
    .then(value => Object.assign(credentialsCache, { value, error: null }))
    .catch(error => Object.assign(credentialsCache, { value: null, error }))
    .finally(() => Object.assign(credentialsCache, { at: Date.now(), pending: null }));
  await credentialsCache.pending;
  if (credentialsCache.error) throw credentialsCache.error;
  return credentialsCache.value;
}

// { token, orgId }; throws with a message saying what is missing
async function loadLogin() {
  const orgFromConfig = () => readJson(path.join(os.homedir(), '.claude.json'))?.oauthAccount?.organizationUuid;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { token: process.env.CLAUDE_CODE_OAUTH_TOKEN, orgId: orgFromConfig() };
  const stored = await credentials(); // throws unless it holds a claude.ai login
  const oauth = stored.claudeAiOauth;
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    credentialsCache.at = 0; // Claude Code may have refreshed it by the next poll
    throw new Error('로그인 토큰이 만료되었습니다. Claude Code를 한 번 실행하면 갱신됩니다');
  }
  return { token: accessTokenOf(oauth), orgId: orgFromConfig() ?? stored.organizationUuid };
}

async function request(method, urlPath, body) {
  const login = await loadLogin();
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

// newest first
const listEvents = (id, limit) => request('GET', `/v1/code/sessions/${encodeURIComponent(id)}/events?limit=${limit}&sort_order=desc`);

const archiveSession = id => request('POST', `/v1/code/sessions/${encodeURIComponent(id)}/archive`, {});

module.exports = { listSessions, listEvents, archiveSession };
