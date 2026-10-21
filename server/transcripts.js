// Reads a session transcript (<project>/<sessionId>.jsonl) into a chat log plus a little live state.
const fs = require('fs');
const path = require('path');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
const STOP_TOOLS = new Set(['TaskStop', 'KillShell']);
const TOOL_HINT_LENGTH = 120;
const BACKGROUND_SHELL = /running in background with ID: ([\w-]+)/;
const TASK_NOTIFICATION = /<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g;

function findTranscript(projectsDir, cwd, sessionId) {
  const expected = path.join(projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'), sessionId + '.jsonl');
  if (fs.existsSync(expected)) return expected;
  if (!fs.existsSync(projectsDir)) return null;
  for (const project of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, project, sessionId + '.jsonl');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const textOf = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';

function toolHint(input = {}) {
  const hint = input.description || input.command || input.file_path || input.pattern || input.prompt || '';
  return hint ? ': ' + String(hint).slice(0, TOOL_HINT_LENGTH) : '';
}

// Shell activity = foreground shell calls still waiting for their result + background shells not yet reported done.
class ShellTracker {
  constructor() { this.pending = new Set(); this.background = new Set(); }

  get count() { return this.pending.size + this.background.size; }

  // a background task finished (queued or delivered, either line works)
  readRawLine(line) {
    if (!line.includes('<task-notification>')) return;
    for (const [, id, status] of line.matchAll(TASK_NOTIFICATION)) if (status !== 'running') this.background.delete(id);
  }

  // only the session's own turns: progress/attachment lines embed subagent messages whose tools never resolve here
  readEntry(entry) {
    if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain || !Array.isArray(entry.message?.content)) return;
    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && SHELL_TOOLS.has(block.name)) this.pending.add(block.id);
      if (block.type === 'tool_use' && STOP_TOOLS.has(block.name)) this.background.delete(block.input?.task_id ?? block.input?.shell_id);
      if (block.type === 'tool_result') {
        this.pending.delete(block.tool_use_id);
        const started = BACKGROUND_SHELL.exec(textOf(block.content));
        if (started) this.background.add(started[1]);
      }
    }
  }
}

function chatMessages(entry, turn) {
  const content = entry.message.content;
  if (entry.type === 'user') {
    const text = textOf(content).trim();
    if (!text || text.startsWith('<')) return []; // tool results, command echoes, reminders
    return [{ role: 'user', text, ts: entry.timestamp, turn: turn + 1 }];
  }
  if (entry.type !== 'assistant' || !Array.isArray(content)) return [];
  const messages = [];
  for (const block of content) {
    if (block.type === 'text' && block.text.trim()) messages.push({ role: 'assistant', text: block.text, ts: entry.timestamp, turn });
    else if (block.type === 'tool_use') messages.push({ role: 'tool', text: block.name + toolHint(block.input), ts: entry.timestamp, turn });
  }
  return messages;
}

function parseTranscriptText(text) {
  const chat = [], shell = new ShellTracker();
  let title = null, name = null, cwd = null, turns = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    shell.readRawLine(line);
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    shell.readEntry(entry);
    if (entry.type === 'ai-title') title = entry.aiTitle;
    if (entry.type === 'custom-title') name = entry.customTitle;
    if (!cwd && entry.cwd) cwd = entry.cwd;
    if (entry.isSidechain || entry.isMeta || !entry.message) continue;
    const messages = chatMessages(entry, turns);
    if (entry.type === 'user' && messages.length) turns++;
    chat.push(...messages);
  }
  return { title, name, cwd, turns, chat, shell: shell.count };
}

// Re-parses the whole file only when it changes. Tail-read with offsets if transcripts get huge.
const cache = new Map();
function parseTranscript(file) {
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit.data;
  const data = parseTranscriptText(fs.readFileSync(file, 'utf8'));
  cache.set(file, { mtime: stat.mtimeMs, size: stat.size, data });
  return data;
}

// Chat log from transcript-shaped entries ({ type, message, timestamp }), e.g. a remote session's events.
function chatFromEntries(entries) {
  const chat = [];
  let turns = 0;
  for (const entry of entries) {
    if (entry.isSidechain || entry.isMeta || !entry.message) continue;
    const messages = chatMessages(entry, turns);
    if (entry.type === 'user' && messages.length) turns++;
    chat.push(...messages);
  }
  return { chat, turns };
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);

// What a session is doing right now, from its latest entries (oldest first): running shells, subagents whose
// tool call hasn't returned yet, and the last tool / prompt. Used for remote sessions, whose events are entries.
function activityOf(entries) {
  const shell = new ShellTracker(), agents = new Map();
  for (const entry of entries) {
    shell.readRawLine(JSON.stringify(entry));
    shell.readEntry(entry);
    if (entry.isSidechain || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && AGENT_TOOLS.has(block.name)) {
        agents.set(block.id, { type: block.input?.subagent_type ?? 'agent', description: block.input?.description ?? '' });
      }
      if (block.type === 'tool_result') agents.delete(block.tool_use_id);
    }
  }
  const { chat } = chatFromEntries(entries);
  return {
    shell: shell.count,
    subagents: [...agents.values()],
    lastTool: chat.findLast(m => m.role === 'tool') ?? null,
    lastUser: chat.findLast(m => m.role === 'user') ?? null,
  };
}

module.exports = { findTranscript, parseTranscript, parseTranscriptText, chatFromEntries, activityOf, toolHint };
