// Costumes belong to the seasonal event, while their anchors follow each character's animation.
import * as THREE from 'three';
import { vox } from '../core/voxel.js';

function witchHat(actor, companion) {
  const hat = new THREE.Group(); hat.name = 'halloween-witch-hat';
  const u = actor.userData, purple = 0x49305f;
  (companion ? u.body : u.head).add(hat);
  hat.position.y = companion ? (u.kind === 'codex' ? .47 : .3) : .58;
  hat.scale.setScalar(companion ? .42 : 1);
  vox(hat, purple, [1.35, .09, 1.1], [0, 0, 0]);
  for (const [w, h, x, y] of [[.82, .2, 0, .09], [.64, .22, .02, .29], [.46, .22, .06, .51], [.3, .18, .13, .73], [.16, .14, .23, .91]]) {
    vox(hat, purple, [w, h, w * .85], [x, y, 0]);
  }
  vox(hat, purple, [.2, .1, .13], [.34, 1, 0]); // floppy tip
  vox(hat, 0xdb883c, [.84, .11, .71], [0, .13, 0]);
  vox(hat, 0xffd16a, [.2, .16, .035], [0, .105, .37]);
  vox(hat, purple, [.09, .08, .04], [0, .145, .39]);
  u.witchHat = hat;
  return () => { hat.removeFromParent(); delete u.witchHat; };
}

function zombie(actor) {
  const skin = actor.userData.skin.map(mesh => {
    const original = mesh.material, costume = original.clone();
    costume.color.setHex(0x8eb474);
    mesh.material = costume;
    return { mesh, original, costume };
  });
  const details = new THREE.Group(); details.name = 'halloween-zombie'; actor.userData.head.add(details);
  for (const side of [-1, 1]) {
    const bolt = new THREE.Group(); bolt.name = 'halloween-bolt'; bolt.position.set(side * .55, -.1, 0); details.add(bolt);
    vox(bolt, 0xa7b2be, [.3, .13, .14], [0, 0, 0]);
    vox(bolt, 0xd3dbe0, [.11, .24, .25], [side * .17, -.055, 0]);
    vox(details, 0x627453, [.19, .05, .025], [side * .18, 0, .415]); // tired eyes
  }
  vox(details, 0x40503a, [.39, .025, .025], [.06, .235, .415]);
  for (const x of [-.08, .04, .16]) vox(details, 0x40503a, [.025, .12, .03], [x, .19, .42]);
  return () => {
    details.removeFromParent();
    for (const { mesh, original, costume } of skin) {
      if (mesh.material === costume) mesh.material = original;
      else mesh.material.color.copy(original.color); // a departing worker may already own a fading clone
      costume.dispose();
    }
  };
}

export function createHalloweenCostumes({ desks = new Map(), visitor } = {}) {
  const dressed = new Map();
  return {
    update() {
      const present = new Set();
      const dress = (actor, kind, canDress = true) => {
        present.add(actor);
        if (!dressed.has(actor) && canDress) {
          dressed.set(actor, kind === 'zombie' ? zombie(actor) : witchHat(actor, kind === 'companion'));
        }
      };
      if (visitor) dress(visitor.obj, 'visitor');
      for (const desk of desks.values()) {
        dress(desk.worker.obj, 'zombie', !desk.fading);
        for (const companion of desk.clawds) dress(companion, 'companion', !desk.fading);
      }
      for (const [actor, restore] of dressed) {
        if (!present.has(actor)) { restore(); dressed.delete(actor); }
      }
    },
    dispose() {
      for (const restore of dressed.values()) restore();
      dressed.clear();
    },
  };
}
