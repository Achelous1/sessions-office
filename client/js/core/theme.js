// Day / night theme: page colors (CSS data-theme), scene lighting, window glass and the pendant lamps.
import { scene, hemiLight, sunLight } from './engine.js';
import { glassMaterial } from './voxel.js';

const THEMES = {
  day:   { bg: 0xdfe6ec, hemi: [0xffffff, 0x8899aa, 1], sun: [0xfff4e0, 1.2], glass: [0xbfe3ff, .35], lamp: 0, bulb: 0x777777, label: '☀︎ 낮' },
  night: { bg: 0x0d111c, hemi: [0x5566aa, 0x111122, .35], sun: [0x8fa8ff, .25], glass: [0x1a2a50, .8], lamp: 25, bulb: 0xfff1c9, label: '☾ 밤' },
};
const DAY_STARTS = 7, NIGHT_STARTS = 19;
const STORAGE_KEY = 'theme';

const lamps = []; // { light, bulb } — pendant lamps are rebuilt with the room
export function clearLamps() { lamps.length = 0; }
export function addLamp(light, bulb) { lamps.push({ light, bulb }); }

// Lights that come and go with their owner: { light, night: intensity, bulb?: mesh, glow?: color }.
// Off by day, on at night. Returns a function that stops tracking it.
const ownedLights = new Set();
function applyOwnedLight(entry) {
  const night = current === 'night';
  entry.light.intensity = night ? entry.night : 0;
  if (entry.bulb) entry.bulb.material.color.setHex(night ? entry.glow : 0xcfc6b4);
}
export function addThemedLight(entry) {
  ownedLights.add(entry);
  applyOwnedLight(entry);
  return () => ownedLights.delete(entry);
}

function storedTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
const themeForHour = hour => hour >= DAY_STARTS && hour < NIGHT_STARTS ? 'day' : 'night';

let current = storedTheme() ?? themeForHour(new Date().getHours());
let toggleButton = null;

export function applyTheme() {
  const t = THEMES[current];
  document.documentElement.dataset.theme = current;
  if (toggleButton) toggleButton.textContent = t.label + ' · 전환';
  scene.background.setHex(t.bg);
  hemiLight.color.setHex(t.hemi[0]); hemiLight.groundColor.setHex(t.hemi[1]); hemiLight.intensity = t.hemi[2];
  sunLight.color.setHex(t.sun[0]); sunLight.intensity = t.sun[1];
  glassMaterial.color.setHex(t.glass[0]); glassMaterial.opacity = t.glass[1];
  for (const { light, bulb } of lamps) { light.intensity = t.lamp; bulb.material.color.setHex(t.bulb); }
  ownedLights.forEach(applyOwnedLight);
}

export function initThemeToggle(button) {
  toggleButton = button;
  button.onclick = () => {
    current = current === 'day' ? 'night' : 'day';
    try { localStorage.setItem(STORAGE_KEY, current); } catch {}
    applyTheme();
  };
  applyTheme();
}
