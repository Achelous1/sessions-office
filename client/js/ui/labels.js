// User-facing names for hosts and statuses.
export const HOST_ICON = { win: '🪟 ', wsl: '🐧 ', linux: '🐧 ', local: '🍎 ', remote: '📡 ', cloud: '☁️ ' };
export const HOST_NAME = { win: '🪟 Windows', wsl: '🐧 WSL', linux: '🐧 Linux', local: '🍎 macOS', remote: '📡 원격 PC', cloud: '☁️ 클라우드' };

// where a session runs, for lists and the chat header: "🐧 Linux", "📡 원격 PC build-box", "☁️ 클라우드"
export const placeOf = s => s.host === 'remote' ? `${HOST_NAME.remote} ${s.workspace.name}` : HOST_NAME[s.host] ?? '';
export const STATUS_NAME = { busy: '작업 중', waiting: '답변 대기', idle: '휴식', unknown: '상태 미확인' };

// Keep the environment and agent mark together wherever a worker is identified.
export function agentEnvironment(session, compact = false) {
  const badge = el('span', 'agent-environment');
  const host = el('span', 'host', compact ? HOST_ICON[session.host] ?? '' : placeOf(session));
  host.title = placeOf(session);
  const logo = el('span', `provider-mark ${session.provider === 'codex' ? 'chatgpt' : 'claude'}`);
  logo.setAttribute('role', 'img');
  logo.setAttribute('aria-label', session.provider === 'codex' ? 'Codex (ChatGPT)' : 'Claude');
  logo.title = session.provider === 'codex' ? 'Codex · ChatGPT' : 'Claude';
  badge.append(host, logo);
  return badge;
}

// small DOM helper: <tag class="className">text</tag>
export function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
