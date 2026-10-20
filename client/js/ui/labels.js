// User-facing names for hosts and statuses.
export const HOST_ICON = { win: '🪟 ', wsl: '🐧 ', linux: '🐧 ', remote: '📡 ', cloud: '☁️ ' };
export const HOST_NAME = { win: '🪟 Windows', wsl: '🐧 WSL', linux: '🐧 Linux', local: '', remote: '📡 원격 PC', cloud: '☁️ 클라우드' };

// where a session runs, for lists and the chat header: "🐧 Linux", "📡 원격 PC build-box", "☁️ 클라우드"
export const placeOf = s => s.host === 'remote' ? `${HOST_NAME.remote} ${s.workspace.name}` : HOST_NAME[s.host] ?? '';
export const STATUS_NAME = { busy: '작업 중', waiting: '답변 대기', idle: '휴식' };

// small DOM helper: <tag class="className">text</tag>
export function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
