// Smooth camera moves: glide to an employee, or zoom out to fit an office. Keeps the viewing angle.
import * as THREE from 'three';
import { camera, controls } from '../core/engine.js';
import { L } from '../world/layout.js';
import { nearestOfficeView } from '../world/offices.js';

const EMPLOYEE_DISTANCE = 11;
const FIT_TIGHTNESS = .72; // the bounding sphere is loose for a flat room
const MARGIN = 1;
let focus = null; // { at: Vector3, dist }

controls.addEventListener('start', () => { focus = null; }); // the user grabbed the camera: stop the glide

export function focusOnEmployee(person) {
  focus = { at: person.position.clone().setY(person.position.y + 1.5), dist: EMPLOYEE_DISTANCE };
}

export const localOfficeBounds = () => ({ minX: L.PX, maxX: L.RX, minZ: L.back, maxZ: L.front, y: 0 });

// bounds: { minX, maxX, minZ, maxZ, y }
export function focusOnBounds({ minX, maxX, minZ, maxZ, y = 0 }) {
  const width = maxX - minX + 2 * MARGIN, depth = maxZ - minZ + 2 * MARGIN, radius = Math.hypot(width, depth, 5) / 2;
  const vFov = camera.fov * Math.PI / 180, hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  focus = { at: new THREE.Vector3((minX + maxX) / 2, y, (minZ + maxZ) / 2), dist: FIT_TIGHTNESS * radius / Math.sin(Math.min(vFov, hFov) / 2) };
}

// the whole office the camera is looking at (offices are too far apart to show together)
export function fitCurrentOffice() {
  focusOnBounds(nearestOfficeView(controls.target) ?? localOfficeBounds());
}

export function stepCameraFocus(dt) {
  if (!focus) return;
  const k = Math.min(1, dt * 4), direction = camera.position.clone().sub(controls.target).normalize();
  const want = focus.at.clone().addScaledVector(direction, focus.dist);
  controls.target.lerp(focus.at, k);
  camera.position.lerp(want, k);
  if (camera.position.distanceTo(want) < .05) focus = null;
}
