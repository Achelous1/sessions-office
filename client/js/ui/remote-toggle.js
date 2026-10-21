// 📡 원격 연결 button: whether the server reads Remote Control and cloud sessions at all.
import { fetchRemoteStatus, setRemoteEnabled } from '../api.js';

function show(button, enabled) {
  button.setAttribute('aria-pressed', String(enabled));
}

// onChange: called after switching, to refresh the office right away
export async function initRemoteToggle(button, onChange) {
  try { show(button, (await fetchRemoteStatus()).enabled); } catch {}
  button.onclick = async () => {
    button.disabled = true;
    try {
      const { enabled } = await setRemoteEnabled(button.getAttribute('aria-pressed') !== 'true');
      show(button, enabled);
      onChange();
    } catch (e) {
      alert('원격 연결 설정을 바꾸지 못했습니다: ' + e.message);
    } finally {
      button.disabled = false;
    }
  };
}
