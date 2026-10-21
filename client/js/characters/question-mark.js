// Spinning voxel "?" over sessions waiting on the user (permission dialog / question).
import * as THREE from 'three';
import { scene } from '../core/engine.js';
import { pixelArt } from '../core/voxel.js';

const ART = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
const PIXEL = .24;
const yellow = new THREE.MeshBasicMaterial({ color: 0xffd400 });

export function makeQuestionMark() {
  const g = new THREE.Group();
  pixelArt(g, yellow, ART, PIXEL, PIXEL * 1.5, { castShadow: false });
  g.visible = false;
  scene.add(g);
  return g;
}

export function updateQuestionMark(mark, person, visible, now) {
  mark.visible = visible;
  if (!visible) return;
  mark.position.copy(person.position);
  mark.position.y += 4.3 + Math.sin(now / 300) * .15;
  mark.rotation.y = now / 400;
}
