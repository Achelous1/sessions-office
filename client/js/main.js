// Session Office client: a voxel office where every live Claude Code session is an employee.
import { renderer, scene, camera, controls, mountRenderer } from './core/engine.js';
import { initThemeToggle } from './core/theme.js';
import { updateWalls, pinZoneSigns } from './world/room.js';
import { desks } from './world/state.js';
import { stepDesks } from './world/desks.js';
import { stepVisitor, visitorAgent } from './world/visitor.js';
import { stepOffices } from './world/offices.js';
import { flyPlanes } from './world/rig-links.js';
import { stepTears } from './characters/crying.js';
import { initChatPanel } from './ui/chat-panel.js';
import { initStaffDrawer } from './ui/staff-drawer.js';
import { initPicking } from './ui/picking.js';
import { fitAll, stepCameraFocus } from './ui/camera-focus.js';
import { poll, startPolling } from './sync.js';

const MAX_FRAME_SECONDS = .1; // after a background tab, don't teleport everyone

mountRenderer(document.getElementById('scene'));
initThemeToggle(document.getElementById('theme'));
initChatPanel();
initStaffDrawer(document.getElementById('list'), poll);
initPicking();
document.getElementById('fit').onclick = fitAll;
startPolling();

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
  last = now;
  stepCameraFocus(dt);
  stepDesks(dt, now);
  stepVisitor(dt, now);
  stepTears(dt, now);
  flyPlanes(now);
  stepOffices(now);
  pinZoneSigns();
  controls.update();
  updateWalls(dt);
  renderer.render(scene, camera);
});

if (location.hash === '#debug') window.office = { camera, controls, desks, visitor: visitorAgent }; // for headless screenshots
