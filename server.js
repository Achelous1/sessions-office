// Voxel office for live Claude Code sessions. Zero deps: `node server.js` then open http://localhost:4545
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const PORT = process.env.PORT || 4545;
const SHOW_SDK = process.env.SHOW_SDK === '1'; // claude-mem observer etc. are hidden by default

// Where Claude Code keeps its state. Under WSL we also read the Windows side (/mnt/c/Users/*/.claude),
// whose PIDs live in another namespace and are checked via PowerShell (see windowsProcs) instead of process.kill.
const IS_WSL = fs.existsSync('/mnt/c/Users') && os.platform() === 'linux';
const SOURCES = [{ dir: path.join(os.homedir(), '.claude'), host: process.platform === 'win32' ? 'win' : IS_WSL ? 'wsl' : process.platform === 'linux' ? 'linux' : 'local' }];
if (IS_WSL) for (const u of fs.readdirSync('/mnt/c/Users')) {
  const dir = path.join('/mnt/c/Users', u, '.claude');
  if (fs.existsSync(path.join(dir, 'sessions'))) SOURCES.push({ dir, host: 'win' });
}

// Windows: pid -> start time (FILETIME, 100ns since 1601) of claude/node/bun processes. Claude Code writes the same
// value as procStart, so a match proves it is the same process. Works from WSL and natively.
const PS_ARGS = ['-NoProfile', '-Command', "Get-Process -Name claude,node,bun -ErrorAction SilentlyContinue | " +
  "ForEach-Object { try { '{0},{1}' -f $_.Id, $_.StartTime.ToFileTimeUtc() } catch {} }; exit 0"]; // missing names would exit 1
const parseWin = out => new Map(out.split('\n').map(l => l.trim().split(',')).filter(([p, t]) => p && t).map(([p, t]) => [Number(p), t]));
let winProcs = { at: 0, map: null, busy: false };
function windowsProcs(fresh) {
  if (fresh || !winProcs.map) { // blocking (~0.8s): first poll and right before a fire
    try { winProcs.map = parseWin(execFileSync('powershell.exe', PS_ARGS, { encoding: 'utf8', timeout: 8000 })); } catch { winProcs.map = new Map(); }
    winProcs.at = Date.now();
  } else if (Date.now() - winProcs.at > 3000 && !winProcs.busy) { // otherwise refresh in the background, serve the cached map
    winProcs.busy = true;
    execFile('powershell.exe', PS_ARGS, { encoding: 'utf8', timeout: 8000 }, (err, out) => {
      if (!err) winProcs.map = parseWin(out);
      winProcs.at = Date.now(); winProcs.busy = false;
    });
  }
  return winProcs.map;
}

// Linux: field 22 of /proc/<pid>/stat is the start time in clock ticks since boot, which Claude Code stores as procStart
function procStartOf(pid) {
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2).split(' ')[19]; } catch { return null; }
}

// "alive" must mean *this* Claude process, not whatever later reused its PID (stale session files do happen)
function alive(s, fresh) {
  if (s.src.host === 'win') {
    const start = windowsProcs(fresh).get(s.pid);
    return start != null && (s.procStart == null || start === String(s.procStart));
  }
  if (fs.existsSync('/proc/self/stat')) {
    const start = procStartOf(s.pid);
    return start != null && (s.procStart == null || start === String(s.procStart));
  }
  try { process.kill(s.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } // ponytail: macOS has no PID-reuse check
}

function transcriptPath(s) {
  const projects = path.join(s.src.dir, 'projects');
  const p = path.join(projects, s.cwd.replace(/[^a-zA-Z0-9]/g, '-'), s.sessionId + '.jsonl');
  if (fs.existsSync(p)) return p;
  if (!fs.existsSync(projects)) return null;
  for (const d of fs.readdirSync(projects)) {
    const q = path.join(projects, d, s.sessionId + '.jsonl');
    if (fs.existsSync(q)) return q;
  }
  return null;
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
const STOP_TOOLS = new Set(['TaskStop', 'KillShell']);
// ponytail: re-parses whole file when it changes; tail-read with offsets if transcripts get huge
const cache = new Map();
function parse(file) {
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.data;
  const chat = [];
  let title = null, name = null, cwd = null, turns = 0;
  // shell activity: foreground shell calls still waiting for their result + background shells not yet reported done
  const pendingShell = new Set(), bgShells = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    if (line.includes('<task-notification>')) // background task finished (queued or delivered, either line works)
      for (const m of line.matchAll(/<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g)) if (m[2] !== 'running') bgShells.delete(m[1]);
    let d; try { d = JSON.parse(line); } catch { continue; }
    // only the session's own turns: progress/attachment lines embed subagent messages whose tools never resolve here
    if ((d.type === 'user' || d.type === 'assistant') && !d.isSidechain && Array.isArray(d.message?.content)) for (const x of d.message.content) {
      if (x.type === 'tool_use' && SHELL_TOOLS.has(x.name)) pendingShell.add(x.id);
      if (x.type === 'tool_use' && STOP_TOOLS.has(x.name)) bgShells.delete(x.input?.task_id ?? x.input?.shell_id);
      if (x.type === 'tool_result') {
        pendingShell.delete(x.tool_use_id);
        const bg = /running in background with ID: ([\w-]+)/.exec(textOf(x.content));
        if (bg) bgShells.add(bg[1]);
      }
    }
    if (d.type === 'ai-title') title = d.aiTitle;
    if (d.type === 'custom-title') name = d.customTitle;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.isSidechain || d.isMeta || !d.message) continue;
    const c = d.message.content;
    if (d.type === 'user') {
      const t = textOf(c).trim();
      if (!t || t.startsWith('<')) continue; // tool results, command echoes, reminders
      turns++;
      chat.push({ role: 'user', text: t, ts: d.timestamp, turn: turns });
    } else if (d.type === 'assistant' && Array.isArray(c)) {
      for (const x of c) {
        if (x.type === 'text' && x.text.trim()) chat.push({ role: 'assistant', text: x.text, ts: d.timestamp, turn: turns });
        else if (x.type === 'tool_use') chat.push({ role: 'tool', text: x.name + toolHint(x.input), ts: d.timestamp, turn: turns });
      }
    }
  }
  const data = { title, name, cwd, turns, chat, shell: pendingShell.size + bgShells.size };
  cache.set(file, { mtime: st.mtimeMs, size: st.size, data });
  return data;
}

function toolHint(i = {}) {
  const h = i.description || i.command || i.file_path || i.pattern || i.prompt || '';
  return h ? ': ' + String(h).slice(0, 120) : '';
}

function liveSessions() {
  const out = [];
  for (const src of SOURCES) {
    const dir = path.join(src.dir, 'sessions');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let s; try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (!s.sessionId) continue;
      s.src = src;
      if (!alive(s)) continue;
      if (!SHOW_SDK && s.entrypoint === 'sdk-cli') continue;
      out.push(s);
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

// running subagents live next to the transcript: <project>/<sessionId>/subagents/agent-*.meta.json (+ .jsonl).
// Newer Claude Code sets finished:true; older builds never do, so "still writing in the last 3 min" covers those.
function subagents(file) { // ponytail: mtime heuristic can drop an agent that thinks >3 min without writing
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const log = path.join(dir, f.replace('.meta.json', '.jsonl'));
      if (meta.finished === true || !fs.existsSync(log) || Date.now() - fs.statSync(log).mtimeMs > 180000) continue;
      out.push({ type: meta.agentType, description: meta.description });
    } catch {}
  }
  return out;
}

function summary(s) {
  const file = transcriptPath(s);
  const p = file ? parse(file) : { title: null, turns: 0, chat: [] };
  const lastUser = [...p.chat].reverse().find(m => m.role === 'user');
  const lastAnswer = [...p.chat].reverse().find(m => m.role === 'assistant');
  const lastTool = [...p.chat].reverse().find(m => m.role === 'tool');
  return {
    id: s.sessionId, pid: s.pid, name: s.name, title: p.title, cwd: s.cwd,
    status: s.status, entrypoint: s.entrypoint, host: s.src.host, startedAt: s.startedAt,
    turns: p.turns, lastUser, lastAnswer, lastTool, subagents: file ? subagents(file) : [], shell: p.shell ?? 0,
  };
}

// past sessions (transcripts without a live process), newest first, with a ready-to-paste resume command
function history(limit = 60) {
  const live = new Set(liveSessions().map(s => s.sessionId));
  const files = [];
  for (const src of SOURCES) {
    const projects = path.join(src.dir, 'projects');
    if (!fs.existsSync(projects)) continue;
    for (const d of fs.readdirSync(projects)) {
      const dir = path.join(projects, d);
      let names; try { names = fs.readdirSync(dir); } catch { continue; }
      for (const f of names) {
        if (!f.endsWith('.jsonl') || live.has(f.slice(0, -6))) continue;
        const file = path.join(dir, f);
        files.push({ file, src, id: f.slice(0, -6), mtime: fs.statSync(file).mtimeMs });
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit).flatMap(({ file, src, id, mtime }) => {
    const p = parse(file); // cached by mtime, so only the first call is slow
    if (!p.turns) return []; // empty / aborted sessions are not worth resuming
    const win = src.host === 'win', cwd = p.cwd;
    const cd = cwd ? (win ? `cd "${cwd}"; ` : `cd '${cwd.replace(/'/g, `'\\''`)}' && `) : '';
    return [{ id, host: src.host, name: p.name, title: p.title, cwd, turns: p.turns, mtime,
              lastUser: p.chat.findLast(m => m.role === 'user')?.text.slice(0, 200),
              command: `${cd}claude --resume ${id}` }];
  });
}

// "fire" = terminate the session process (like Ctrl+C in its terminal)
function fire(s) {
  if (!alive(s, true)) throw new Error('process identity changed; refusing to kill');
  // Windows has no SIGTERM for windowless processes (desktop-app sessions have none), so plain taskkill fails:
  // /F terminates, /T also takes down the shells Claude spawned
  if (s.src.host === 'win') execFileSync('taskkill.exe', ['/F', '/T', '/PID', String(s.pid)], { timeout: 5000 });
  else process.kill(s.pid, 'SIGTERM');
}

// OpenRig (optional): who delegates to whom, from the local daemon's graph API. Empty when OpenRig isn't running.
let rigCache = { at: 0, data: [] };
async function rigs() {
  if (Date.now() - rigCache.at < 10000) return rigCache.data;
  let data = [];
  try {
    const { port } = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openrig', 'daemon.json'), 'utf8'));
    const get = async url => (await fetch(url, { signal: AbortSignal.timeout(2000) })).json();
    const base = `http://127.0.0.1:${port}/api/rigs`;
    data = await Promise.all((await get(base)).map(async r => {
      const g = await get(`${base}/${r.id}/graph`);
      // resumeToken is the Claude session id; the session name is a fallback if the token went stale
      const nodes = new Map(g.nodes.filter(n => n.type === 'rigNode')
        .map(n => [n.id, { id: n.data.resumeToken, name: n.data.canonicalSessionName, logicalId: n.data.logicalId }]));
      return { name: r.name, members: [...nodes.values()],
               edges: g.edges.filter(e => nodes.has(e.source) && nodes.has(e.target))
                 .map(e => ({ from: nodes.get(e.source), to: nodes.get(e.target), kind: e.label })) };
    }));
  } catch {}
  rigCache = { at: Date.now(), data };
  return data;
}

http.createServer((req, res) => {
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
    const v = req.url.match(/^\/vendor\/([\w.]+\.js)$/); // three.js r160, vendored to dodge CDN/proxy issues
    if (v && fs.existsSync(path.join(__dirname, 'vendor', v[1]))) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return fs.createReadStream(path.join(__dirname, 'vendor', v[1])).pipe(res);
    }
    if (req.url === '/api/sessions') return json(liveSessions().map(summary));
    if (req.url === '/api/history') return json(history());
    if (req.url === '/api/rigs') return rigs().then(json);
    const f = req.url.match(/^\/api\/session\/([\w-]+)\/fire$/);
    if (f) {
      // the custom header forces a CORS preflight we never answer, so other websites can't fire sessions
      if (req.method !== 'POST' || req.headers['x-office'] !== '1') return json({ error: 'forbidden' }, 403);
      const s = liveSessions().find(x => x.sessionId === f[1]);
      if (!s) return json({ error: 'not found' }, 404);
      try { fire(s); } catch (e) { return json({ error: e.message }, 409); }
      return json({ ok: true });
    }
    const m = req.url.match(/^\/api\/session\/([\w-]+)$/);
    if (m) {
      const s = liveSessions().find(x => x.sessionId === m[1]);
      if (!s) return json({ error: 'not found' }, 404);
      const file = transcriptPath(s);
      return json({ ...summary(s), chat: file ? parse(file).chat.slice(-300) : [] });
    }
    res.writeHead(404); res.end();
  } catch (e) { json({ error: String(e) }, 500); }
}).listen(PORT, '127.0.0.1', () => console.log(`session office: http://localhost:${PORT}\nreading: ${SOURCES.map(s => `${s.host}=${s.dir}`).join(', ')}`));
