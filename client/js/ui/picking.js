// Click (not drag) on a desk or worker to open that session's chat.
import * as THREE from 'three';
import { camera, renderer } from '../core/engine.js';
import { clickables } from '../world/state.js';
import { openChat } from './chat-panel.js';

const DRAG_THRESHOLD_PX = 5;

export function initPicking() {
  const canvas = renderer.domElement, ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let downAt = null;
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > DRAG_THRESHOLD_PX) return; // was a drag
    pointer.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(clickables)[0];
    if (hit) openChat(hit.object.userData.sid);
  });
}
