// Runtime settings and the Claude Code state directories the server reads.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT) || 4545;
const HOSTNAME = '127.0.0.1'; // local only: transcripts never leave this machine
const SHOW_SDK = process.env.SHOW_SDK === '1'; // claude-mem observer etc. are hidden by default

// Remote Control sessions on other PCs + claude.ai/code cloud sessions, read through the login of Claude Code.
// The 원격 연결 toggle in the page switches it at runtime (saved in SETTINGS_FILE); REMOTE=0 starts with it off
// when nothing is saved yet. REMOTE_API_URL is only for tests against a mock server.
const SHOW_REMOTE = process.env.REMOTE !== '0';
const SETTINGS_FILE = path.join(os.homedir(), '.session-office', 'settings.json');
const REMOTE_API_URL = process.env.REMOTE_API_URL || 'https://api.anthropic.com';
const MAX_CLOUD_SESSIONS = Number(process.env.MAX_CLOUD_SESSIONS) || 24;

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const OPENRIG_DAEMON_FILE = path.join(os.homedir(), '.openrig', 'daemon.json');

const WINDOWS_USERS_DIR = '/mnt/c/Users';
const IS_WSL = os.platform() === 'linux' && fs.existsSync(WINDOWS_USERS_DIR);

function localHost() {
  if (process.platform === 'win32') return 'win';
  if (IS_WSL) return 'wsl';
  if (process.platform === 'linux') return 'linux';
  return 'local';
}

// Where Claude Code keeps its state. Under WSL we also read the Windows side (/mnt/c/Users/*/.claude),
// whose PIDs live in another namespace and are checked via PowerShell instead of /proc.
function claudeSources() {
  const sources = [{ dir: path.join(os.homedir(), '.claude'), host: localHost() }];
  if (!IS_WSL) return sources;
  for (const user of fs.readdirSync(WINDOWS_USERS_DIR)) {
    const dir = path.join(WINDOWS_USERS_DIR, user, '.claude');
    if (fs.existsSync(path.join(dir, 'sessions'))) sources.push({ dir, host: 'win' });
  }
  return sources;
}

const SOURCES = claudeSources();

module.exports = { PORT, HOSTNAME, SHOW_SDK, SHOW_REMOTE, SETTINGS_FILE, REMOTE_API_URL, MAX_CLOUD_SESSIONS, CLIENT_DIR, OPENRIG_DAEMON_FILE, SOURCES };
