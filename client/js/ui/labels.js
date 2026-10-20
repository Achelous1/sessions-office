// User-facing names for hosts and statuses.
export const HOST_ICON = { win: '🪟 ', wsl: '🐧 ', linux: '🐧 ' };
export const HOST_NAME = { win: '🪟 Windows', wsl: '🐧 WSL', linux: '🐧 Linux', local: '' };
export const STATUS_NAME = { busy: '작업 중', waiting: '답변 대기', idle: '휴식' };

// small DOM helper: <tag class="className">text</tag>
export function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
