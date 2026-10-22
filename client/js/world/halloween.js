// Seasonal props use the office's voxel palette; only pumpkins add point lights.
import * as THREE from 'three';
import { vox } from '../core/voxel.js';
import { addThemedLight } from '../core/theme.js';
import { createHalloweenCostumes } from '../characters/halloween-costumes.js';

export const halloweenEvent = {
  id: 'halloween',
  period: { start: { month: 10, day: 20 }, end: { month: 11, day: 1 } },
  create: createHalloween,
};

function createHalloween({ parent, walls, bounds, camera, desks, visitor }) {
  const { PX, LX, RX, back, front, EZ, DZ } = bounds;
  const root = new THREE.Group(); root.name = 'halloween'; parent.add(root);
  const attachments = [root], materials = [], releaseLights = [], candles = [], ghosts = [];
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const costumes = createHalloweenCostumes({ desks, visitor });
  const ownMaterial = (Type, options) => {
    const mat = new Type(options); materials.push(mat); return mat;
  };
  const flameMat = ownMaterial(THREE.MeshBasicMaterial, { color: 0xffc85c });
  const hotMat = ownMaterial(THREE.MeshBasicMaterial, { color: 0xfff2bb });
  const lanternMat = ownMaterial(THREE.MeshBasicMaterial, { color: 0xffd477 });
  const fairyGlow = ownMaterial(THREE.MeshBasicMaterial,
    { color: 0xffbb55, transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending });
  const batMat = ownMaterial(THREE.MeshLambertMaterial, { color: 0x806398, emissive: 0x3c2948 });
  const glowVoxel = (group, mat, size, pos) => {
    const mesh = vox(group, mat, size, pos); mesh.castShadow = false; return mesh;
  };

  function candle(x, y, z, index) {
    const g = new THREE.Group(); g.name = 'halloween-candle'; g.position.set(x, y, z); root.add(g);
    const height = .55 + (index % 3) * .14;
    vox(g, 0xf4e3bf, [.22, height, .22], [0, 0, 0]);
    vox(g, 0xffefd1, [.08, .23, .05], [-.07, height - .28, .13]); // wax drip
    vox(g, 0xffefd1, [.06, .14, .05], [.08, height - .18, .13]);
    vox(g, 0x46342a, [.04, .1, .04], [0, height, 0]);
    const flame = new THREE.Group(); flame.position.y = height + .08; g.add(flame);
    glowVoxel(flame, flameMat, [.16, .22, .14], [0, 0, 0]);
    glowVoxel(flame, hotMat, [.08, .13, .08], [0, .04, .04]);
    glowVoxel(flame, flameMat, [.08, .12, .08], [.025, .22, 0]);
    candles.push({ group: g, flame, y, phase: index * 1.7 });
  }

  function bat(group, x, y, z, index) {
    const g = new THREE.Group(); g.name = 'halloween-bat';
    g.position.set(x, y, z); g.rotation.z = index % 2 ? -.12 : .12; g.scale.setScalar(1.25); group.add(g);
    vox(g, batMat, [.18, .3, .1], [0, -.12, 0]);
    for (const side of [-1, 1]) {
      vox(g, batMat, [.07, .12, .1], [side * .07, .14, 0]); // ears
      vox(g, batMat, [.18, .24, .08], [side * .19, -.02, 0]);
      vox(g, batMat, [.18, .2, .08], [side * .34, .06, 0]);
      vox(g, batMat, [.13, .16, .08], [side * .48, .16, 0]);
      vox(g, batMat, [.08, .12, .08], [side * .23, -.12, 0]);
      glowVoxel(g, hotMat, [.035, .045, .015], [side * .045, .075, .06]);
    }
  }

  function garland(wall, x0, x1, z) {
    const g = new THREE.Group(); g.name = 'halloween-garland'; wall.add(g); attachments.push(g);
    // Window centers are PX + 3 + 5n; the cord rises halfway between them.
    const sag = x => 4.8 - .85 * Math.abs(Math.cos((x - PX - 3) * Math.PI / 5));
    // Include each hanging point exactly so the upper tips stay sharp.
    const points = [x0], firstGridX = PX + 3 + Math.ceil((x0 - PX - 3) * 4) / 4;
    for (let x = firstGridX; x < x1; x += .25) if (x > x0) points.push(x);
    points.push(x1);
    for (let i = 1; i < points.length; i++) {
      const left = points[i - 1], right = points[i], dx = right - left, dy = sag(right) - sag(left);
      const cord = vox(g, 0x65446c, [Math.hypot(dx, dy) + .015, .045, .045],
        [left + dx / 2, (sag(left) + sag(right)) / 2, z]);
      cord.rotation.z = Math.atan2(dy, dx);
    }
    for (let x = x0 + .25, i = 0; x < x1 - .1; x += .55, i++) {
      const y = sag(x), bulb = i % 3 === 0 ? flameMat : hotMat;
      vox(g, 0x65446c, [.055, .09, .055], [x, y - .09, z]);
      glowVoxel(g, bulb, [.2, .14, .18], [x, y - .23, z]);
      glowVoxel(g, bulb, [.14, .22, .12], [x, y - .27, z]);
      glowVoxel(g, fairyGlow, [.34, .34, .3], [x, y - .33, z]);
    }
    const firstBat = PX + 3 + Math.ceil((x0 - PX - 3) / 5) * 5;
    for (let x = firstBat, i = 0; x <= x1; x += 5, i++) {
      const y = sag(x); // bats hang at each wave's lowest point
      vox(g, 0x65446c, [.025, .62, .025], [x, y - .62, z]);
      bat(g, x, y - .9, z, i);
    }
  }

  function pumpkin(x, y, z, scale, yaw = 0) {
    const g = new THREE.Group(); g.name = 'halloween-pumpkin';
    g.position.set(x, y, z); g.scale.setScalar(scale); g.rotation.y = yaw; root.add(g);
    vox(g, 0xd96b22, [.82, .16, .72], [0, 0, 0]);
    vox(g, 0xed852b, [1.08, .65, .88], [0, .16, 0]);
    vox(g, 0xf69537, [.86, .18, .74], [0, .81, 0]);
    for (const side of [-1, 1]) {
      vox(g, 0xdf7523, [.16, .51, .72], [side * .58, .23, 0]);
      vox(g, 0xffa141, [.08, .63, .035], [side * .4, .17, .46]);
    }
    const stem = vox(g, 0x5f653b, [.16, .25, .17], [.03, .98, 0]); stem.rotation.z = -.2;
    vox(g, 0x7c8d42, [.3, .07, .16], [.17, 1.02, .02]);
    for (const side of [-1, 1]) {
      glowVoxel(g, lanternMat, [.2, .12, .035], [side * .24, .59, .46]);
      glowVoxel(g, lanternMat, [.1, .09, .035], [side * .24, .71, .46]);
      glowVoxel(g, lanternMat, [.12, .12, .035], [side * .3, .31, .46]);
    }
    glowVoxel(g, lanternMat, [.49, .12, .035], [0, .24, .46]);
    glowVoxel(g, lanternMat, [.08, .09, .035], [0, .47, .46]);
    vox(g, 0xc75c1c, [.09, .08, .04], [.1, .3, .48]); // tooth
    const light = new THREE.PointLight(0xff9a3c, 0, 8, 1.6);
    light.position.set(0, .65, .85); g.add(light);
    releaseLights.push(addThemedLight({ light, night: 7 }));
  }

  function ghost(index) {
    const g = new THREE.Group(); g.name = 'halloween-ghost'; g.visible = false; root.add(g);
    const body = ownMaterial(THREE.MeshLambertMaterial,
      { color: 0xf2f8ff, emissive: 0x66758c, transparent: true, opacity: 0, depthWrite: false });
    const face = ownMaterial(THREE.MeshBasicMaterial,
      { color: 0x39405e, transparent: true, opacity: 0, depthWrite: false });
    const blush = ownMaterial(THREE.MeshBasicMaterial,
      { color: 0xf3acbc, transparent: true, opacity: 0, depthWrite: false });
    glowVoxel(g, body, [.78, .2, .6], [0, 1.12, 0]);
    glowVoxel(g, body, [1.06, .75, .72], [0, .37, 0]);
    for (const x of [-.38, 0, .38]) glowVoxel(g, body, [.28, .23, .65], [x, .14, 0]);
    for (const side of [-1, 1]) {
      const arm = glowVoxel(g, body, [.27, .18, .4], [side * .63, .57, 0]); arm.rotation.z = side * .35;
      glowVoxel(g, face, [.12, .19, .035], [side * .22, .78, .38]);
      glowVoxel(g, blush, [.16, .07, .035], [side * .35, .65, .38]);
      glowVoxel(g, face, [.05, .07, .035], [side * .09, .62, .38]);
    }
    glowVoxel(g, face, [.14, .045, .035], [0, .59, .38]);
    const scale = index ? 1.15 : 1.4;
    g.scale.set(scale * .72, scale, scale * .75);
    ghosts.push({ group: g, materials: [body, face, blush], index });
  }

  // Hang above the pantry/lounge and perimeter, clear of desks and staff labels.
  [[LX - 3, 3.4, DZ + 1], [LX - 6, 4, DZ - 1], [LX - 9, 3.6, DZ + 3],
    [10, 4.3, back + 5.7], [14, 3.7, back + 7], [12, 4.5, back + 9],
    [-10, 4.3, front - 1.3], [2, 3.7, front - 1.2]].forEach((p, i) => candle(...p, i));
  garland(walls.back, LX + 1.8, RX - 1.6, back + 1.45); // in front of the freestanding whiteboard
  garland(walls.front, PX + 2, RX - 2, front - .45);
  pumpkin(RX - 1, 0, EZ - 2.5, 1.2, .25);
  pumpkin(RX + .9, 0, EZ + 2.4, 1, .25);
  pumpkin(5.1, 1.6, back + .6, .75);
  pumpkin(-25.6, 1.22, back + .65, .75);
  ghost(0); ghost(1);

  let startedAt = null;
  return {
    update(now) {
      costumes.update();
      startedAt ??= now;
      const t = (now - startedAt) / 1000, reduced = motion?.matches;
      for (const { group, flame, y, phase } of candles) {
        group.position.y = y + (reduced ? 0 : Math.sin(t * .85 + phase) * .18);
        group.rotation.z = reduced ? 0 : Math.sin(t * .6 + phase) * .035;
        flame.scale.y = reduced ? 1 : 1 + Math.sin(t * 5 + phase) * .08;
      }
      for (const { group, materials: ghostMaterials, index } of ghosts) {
        const age = reduced ? 7 : (t + index * 10) % 34;
        const opacity = Math.max(0, Math.min(age / 2, (18 - age) / 3, 1)) * .86;
        group.visible = opacity > 0;
        ghostMaterials.forEach(mat => { mat.opacity = opacity; });
        const travel = Math.min(age / 18, 1), bob = reduced ? 0 : Math.sin(t * 1.4 + index) * .28;
        if (index === 0) group.position.set(RX + 3.1 + Math.sin(travel * Math.PI) * .6, 1.7 + bob, EZ - 3 + travel * 6);
        else group.position.set(LX + 5 + travel * 9, 2.1 + bob, front + 3);
        group.rotation.y = camera ? Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z) : .3;
        group.rotation.z = reduced ? 0 : Math.sin(t * .8 + index) * .07;
      }
    },
    dispose() {
      costumes.dispose();
      releaseLights.forEach(release => release());
      attachments.forEach(group => group.removeFromParent());
      materials.forEach(mat => mat.dispose());
    },
  };
}
