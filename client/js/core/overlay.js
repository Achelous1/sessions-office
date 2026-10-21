// HTML overlays (name tags, speech bubbles, zone signs) pinned to 3D objects.
import * as THREE from 'three';
import { camera } from './engine.js';

const BUBBLE_LENGTH = 140;

export function overlayElement(className, text = '') {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  document.getElementById('overlay').appendChild(element);
  return element;
}

export const clip = (text, max = BUBBLE_LENGTH) => (text || '').replace(/\s+/g, ' ').slice(0, max) + ((text || '').length > max ? '…' : '');

export function showBubble(bubble, text) {
  bubble.textContent = clip(text);
  bubble.style.opacity = 1;
}

export function hiddenBubble(className) {
  const bubble = overlayElement(className);
  bubble.style.opacity = 0;
  return bubble;
}

const projected = new THREE.Vector3();
// Positions `element` on screen at `height` units above `object`; hides it when behind the camera.
export function pin(element, object, height) {
  object.getWorldPosition(projected);
  projected.y += height;
  projected.project(camera);
  element.style.left = (projected.x + 1) / 2 * innerWidth + 'px';
  element.style.top = (1 - projected.y) / 2 * innerHeight + 'px';
  element.style.display = projected.z > 1 ? 'none' : '';
}
