// Is a session's Claude Code process still the one that wrote the session file, and how to stop it.
// "Alive" must mean *this* process, not whatever later reused its PID (stale session files do happen),
// so the process start time is compared with the procStart that Claude Code recorded.
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');

const POWERSHELL_TIMEOUT_MS = 8000;
const WINDOWS_CACHE_MS = 3000;
const TASKKILL_TIMEOUT_MS = 5000;

// Windows: pid -> start time (FILETIME, 100ns since 1601) of claude/node/bun processes. Claude Code writes the same
// value as procStart. Works from WSL and natively.
const POWERSHELL_ARGS = ['-NoProfile', '-Command', "Get-Process -Name claude,node,bun -ErrorAction SilentlyContinue | " +
  "ForEach-Object { try { '{0},{1}' -f $_.Id, $_.StartTime.ToFileTimeUtc() } catch {} }; exit 0"]; // missing names would exit 1

function parseWindowsProcesses(output) {
  const entries = output.split('\n')
    .map(line => line.trim().split(','))
    .filter(([pid, start]) => pid && start)
    .map(([pid, start]) => [Number(pid), start]);
  return new Map(entries);
}

const windowsCache = { at: 0, map: null, refreshing: false };

// Blocking (~0.8s) on the first call and when `fresh` is set (right before a fire);
// otherwise serves the cached map and refreshes it in the background.
function windowsProcessStarts(fresh) {
  if (fresh || !windowsCache.map) {
    try {
      windowsCache.map = parseWindowsProcesses(execFileSync('powershell.exe', POWERSHELL_ARGS, { encoding: 'utf8', timeout: POWERSHELL_TIMEOUT_MS }));
    } catch {
      windowsCache.map = new Map();
    }
    windowsCache.at = Date.now();
  } else if (Date.now() - windowsCache.at > WINDOWS_CACHE_MS && !windowsCache.refreshing) {
    windowsCache.refreshing = true;
    execFile('powershell.exe', POWERSHELL_ARGS, { encoding: 'utf8', timeout: POWERSHELL_TIMEOUT_MS }, (err, output) => {
      if (!err) windowsCache.map = parseWindowsProcesses(output);
      windowsCache.at = Date.now();
      windowsCache.refreshing = false;
    });
  }
  return windowsCache.map;
}

// Linux: field 22 of /proc/<pid>/stat is the start time in clock ticks since boot, which Claude Code stores as procStart
function linuxProcessStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch {
    return null;
  }
}

const startMatches = (start, session) => start != null && (session.procStart == null || start === String(session.procStart));

function isAlive(session, { fresh = false } = {}) {
  if (session.src.host === 'win') return startMatches(windowsProcessStarts(fresh).get(session.pid), session);
  if (fs.existsSync('/proc/self/stat')) return startMatches(linuxProcessStart(session.pid), session);
  try { // macOS has no PID-reuse check
    process.kill(session.pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// "Fire" = terminate the session process, like Ctrl+C in its terminal.
function terminate(session) {
  if (!isAlive(session, { fresh: true })) throw new Error('process identity changed; refusing to kill');
  // Windows has no SIGTERM for windowless processes (desktop-app sessions have none), so plain taskkill fails:
  // /F terminates, /T also takes down the shells Claude spawned
  if (session.src.host === 'win') execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(session.pid)], { timeout: TASKKILL_TIMEOUT_MS });
  else process.kill(session.pid, 'SIGTERM');
}

module.exports = { isAlive, terminate, parseWindowsProcesses };
