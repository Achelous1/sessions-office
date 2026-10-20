// Laptop screen: scrolling terminal output while a shell command / monitor runs, a pulsing glow while busy, dark otherwise.
import * as THREE from 'three';

const WIDTH = 128, HEIGHT = 80, LINE_HEIGHT = 7, MAX_LINES = 11;
const TEXT_COLORS = ['#9be29b', '#d7dde4', '#d7dde4', '#7fb4ff', '#f0c674'];
const BUSY_BRIGHT = 0x9fd8ff, BUSY_DIM = 0x5ab0f0, IDLE = 0x223040;

function addLine(term) {
  const words = Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => 4 + Math.random() * 22);
  term.lines.push({ words, indent: Math.random() < .3 ? 8 : 0, color: TEXT_COLORS[Math.floor(Math.random() * TEXT_COLORS.length)] });
  if (term.lines.length > MAX_LINES) term.lines.shift();
}

function drawTerminal(desk, now) {
  const screen = desk.screen.material;
  desk.term ??= (() => {
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    return { ctx: canvas.getContext('2d'), texture: new THREE.CanvasTexture(canvas), lines: [], next: 0 };
  })();
  const term = desk.term;
  if (screen.map !== term.texture) { screen.map = term.texture; screen.color.setHex(0xffffff); screen.needsUpdate = true; }
  if (now < term.next) return;
  term.next = now + 70 + Math.random() * 110; // bursty, like real output
  addLine(term);
  const g = term.ctx;
  g.fillStyle = '#0c0f14'; g.fillRect(0, 0, WIDTH, HEIGHT);
  term.lines.forEach((line, i) => {
    let x = 6 + line.indent;
    g.fillStyle = line.color;
    for (const w of line.words) { if (x > 120) break; g.fillRect(x, 4 + i * LINE_HEIGHT, Math.min(w, 122 - x), 4); x += w + 4; }
  });
  if (now % 800 < 400) { g.fillStyle = '#d7dde4'; g.fillRect(6, 4 + term.lines.length * LINE_HEIGHT, 5, 5); } // cursor
  term.texture.needsUpdate = true;
}

function plainScreen(desk, color) {
  const screen = desk.screen.material;
  if (screen.map) { screen.map = null; screen.needsUpdate = true; }
  screen.color.setHex(color);
}

export function updateLaptopScreen(desk, now) {
  const { status, shell } = desk.session;
  if (shell > 0 || status === 'shell') return drawTerminal(desk, now);
  if (status === 'busy') return plainScreen(desk, Math.sin(now / 150) > .7 ? BUSY_BRIGHT : BUSY_DIM);
  plainScreen(desk, IDLE);
}
