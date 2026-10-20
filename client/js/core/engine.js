// three.js renderer, scene, camera, orbit controls and the two scene-wide lights.
import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;

export const scene = new THREE.Scene();
scene.background = new THREE.Color();

export const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
camera.position.set(12, 30, 34);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-6, 0, 0);
controls.maxPolarAngle = Math.PI / 2.2;

export const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 0.95);
scene.add(hemiLight);

export const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
sunLight.position.set(10, 30, 16);
sunLight.castShadow = true;
sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -40;
sunLight.shadow.camera.right = sunLight.shadow.camera.top = 40;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

export function mountRenderer(container) {
  container.appendChild(renderer.domElement);
  addEventListener('resize', resize);
  resize();
}
