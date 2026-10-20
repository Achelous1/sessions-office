// Everything in the office is built from unit boxes ("voxels") scaled and placed by their bottom center.
import * as THREE from 'three';

const materials = new Map();
export const material = color => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
  return materials.get(color);
};

export const glassMaterial = new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: .35 });

const unitBox = new THREE.BoxGeometry(1, 1, 1);

// Adds a box of size [w, h, d] whose bottom center sits at [x, y, z]. `color` is a hex number or a material.
export function vox(parent, color, [w, h, d], [x, y, z]) {
  const mesh = new THREE.Mesh(unitBox, typeof color === 'number' ? material(color) : color);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Draws pixel art: one string per row from the top, '#' = a voxel of size `px`.
// The art is centered on x; y is the bottom of the lowest row.
export function pixelArt(parent, mat, rows, px, depth, { x = 0, y = 0, z = 0, castShadow = true } = {}) {
  rows.forEach((row, r) => [...row].forEach((c, col) => {
    if (c !== '#') return;
    const pixel = vox(parent, mat, [px, px, depth], [x + (col - (row.length - 1) / 2) * px, y + (rows.length - 1 - r) * px, z]);
    pixel.castShadow = castShadow;
  }));
}
