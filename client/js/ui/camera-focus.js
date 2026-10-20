// Smooth camera moves: glide to an employee, or zoom out to fit the whole room. Keeps the current viewing angle.
import * as THREE from 'three';
import { camera, controls } from '../core/engine.js';
import { L } from '../world/layout.js';

const EMPLOYEE_DISTANCE = 11;
const FIT_TIGHTNESS = .72; // the bounding sphere is loose for a flat room
let focus = null; // { at: Vector3, dist }

controls.addEventListener('start', () => { focus = null; }); // the user grabbed the camera: stop the glide

export function focusOnEmployee(person) {
  focus = { at: person.position.clone().setY(1.5), dist: EMPLOYEE_DISTANCE };
}

export function fitRoom() {
  const width = L.RX - L.PX + 2, depth = L.front - L.back + 2, radius = Math.hypot(width, depth, 5) / 2;
  const vFov = camera.fov * Math.PI / 180, hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const center = new THREE.Vector3((L.PX + L.RX) / 2, 0, (L.back + L.front) / 2);
  focus = { at: center, dist: FIT_TIGHTNESS * radius / Math.sin(Math.min(vFov, hFov) / 2) };
}

export function stepCameraFocus(dt) {
  if (!focus) return;
  const k = Math.min(1, dt * 4), direction = camera.position.clone().sub(controls.target).normalize();
  const want = focus.at.clone().addScaledVector(direction, focus.dist);
  controls.target.lerp(focus.at, k);
  camera.position.lerp(want, k);
  if (camera.position.distanceTo(want) < .05) focus = null;
}
