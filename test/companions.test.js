const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// Run the browser modules with the vendored Three.js on Node 18 too; only import locations change.
async function modules(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-companions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    'three.mjs': 'client/vendor/three.module.js',
    'voxel.mjs': 'client/js/core/voxel.js',
    'palette.mjs': 'client/js/world/palette.js',
    'clawd.mjs': 'client/js/characters/clawd.js',
    'person.mjs': 'client/js/characters/person.js',
    'codex-companion.mjs': 'client/js/characters/codex-companion.js',
    'laptop-screen.mjs': 'client/js/world/laptop-screen.js',
    'theme.mjs': 'client/js/core/theme.js',
    'halloween-costumes.mjs': 'client/js/characters/halloween-costumes.js',
  };
  for (const [name, source] of Object.entries(files)) {
    const code = fs.readFileSync(path.join(__dirname, '..', source), 'utf8')
      .replace(/from 'three'/g, "from './three.mjs'")
      .replace(/from '(?:\.\/|\.\.\/core\/|\.\.\/world\/)([^/]+)\.js'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(dir, name), code);
  }
  const THREE = await import(pathToFileURL(path.join(dir, 'three.mjs')));
  const companions = await import(pathToFileURL(path.join(dir, 'clawd.mjs')));
  const workers = await import(pathToFileURL(path.join(dir, 'person.mjs')));
  const palette = await import(pathToFileURL(path.join(dir, 'palette.mjs')));
  const laptop = await import(pathToFileURL(path.join(dir, 'laptop-screen.mjs')));
  // The theme's WebGL/browser boundary is replaced; its light lifecycle runs unchanged.
  fs.writeFileSync(path.join(dir, 'engine.mjs'), `import * as THREE from './three.mjs';
    export const scene = new THREE.Scene(); scene.background = new THREE.Color();
    export const hemiLight = new THREE.HemisphereLight(); export const sunLight = new THREE.DirectionalLight();`);
  const theme = await import(pathToFileURL(path.join(dir, 'theme.mjs')));
  const costumes = await import(pathToFileURL(path.join(dir, 'halloween-costumes.mjs')));
  return { THREE, ...companions, ...workers, ...palette, ...laptop, ...theme, ...costumes };
}

test('Halloween dresses the visitor and both subagent providers as witches, and workers as zombies', async t => {
  const { THREE, person, pose, syncClawds, animateClawd, createHalloweenCostumes } = await modules(t);
  const visitor = { obj: person('visitor') }, worker = person('worker');
  const skin = [...worker.userData.skin], originalMaterials = skin.map(mesh => mesh.material);
  const shirt = worker.children.find(c => c.isMesh).material;
  const desk = { group: new THREE.Group(), worker: { obj: worker }, session: { provider: 'claude' }, clawds: [] };
  const desks = new Map([['worker', desk]]);
  syncClawds(desk, [{ provider: 'claude' }, { provider: 'codex' }]);
  const costumes = createHalloweenCostumes({ visitor, desks });
  costumes.update();
  assert.equal(visitor.obj.userData.witchHat.parent, visitor.obj.userData.head);
  assert.equal(worker.userData.witchHat, undefined);
  assert.ok(worker.userData.head.getObjectByName('halloween-zombie'));
  assert.equal(skin.length, 3, 'face and both hands change skin');
  assert.ok(skin.every((mesh, i) => mesh.material !== originalMaterials[i]));
  assert.ok(skin.every(mesh => mesh.material.color.g > mesh.material.color.r));
  assert.equal(worker.children.find(c => c.isMesh).material, shirt);
  const bolts = worker.userData.head.getObjectByName('halloween-zombie').children.filter(c => c.name === 'halloween-bolt');
  assert.equal(bolts.length, 2);
  assert.ok(bolts[0].position.x < -.4 && bolts[1].position.x > .4);
  for (const companion of desk.clawds) {
    const hat = companion.userData.witchHat;
    assert.equal(hat.parent, companion.userData.body);
    animateClawd(companion, 1234);
    assert.ok(hat.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite));
    assert.equal(Object.values(companion.userData.faces).filter(f => f.visible).length, 1);
  }
  pose(visitor.obj, 'walk', 1000);
  const hat = visitor.obj.userData.witchHat;
  visitor.obj.userData.head.rotation.y = .7;
  assert.equal(hat.parent.rotation.y, .7);
  costumes.update();
  assert.equal(visitor.obj.userData.witchHat, hat, 'updates do not stack hats');
  const costumeSkin = skin.map(mesh => mesh.material);
  let disposed = 0;
  costumeSkin.forEach(mat => mat.addEventListener('dispose', () => disposed++));
  costumes.dispose();
  assert.equal(visitor.obj.userData.witchHat, undefined);
  assert.ok(desk.clawds.every(c => !c.userData.witchHat));
  assert.equal(worker.userData.head.getObjectByName('halloween-zombie'), undefined);
  assert.deepEqual(skin.map(mesh => mesh.material), originalMaterials);
  assert.equal(disposed, 3);
});

test('costumes follow new and removed subagents, and restore skin without breaking an in-progress fade', async t => {
  const { THREE, person, syncClawds, createHalloweenCostumes } = await modules(t);
  const worker = person('same-seed'), untouched = person('same-seed');
  const skinColor = untouched.userData.skin[0].material.color.clone();
  const desk = { group: new THREE.Group(), worker: { obj: worker }, session: { provider: 'codex' }, clawds: [] };
  const desks = new Map([['worker', desk]]), costumes = createHalloweenCostumes({ desks });
  costumes.update();
  assert.ok(untouched.userData.skin[0].material.color.equals(skinColor), 'shared skin materials stay untouched');
  syncClawds(desk, Array.from({ length: 7 }, () => ({ provider: 'codex' })));
  costumes.update();
  assert.ok(desk.clawds.every(c => c.userData.witchHat));
  assert.equal(desk.clawds[6].parent, worker, 'the head rider retains its anchor');
  const removed = desk.clawds[0];
  syncClawds(desk, [{ provider: 'claude' }]);
  costumes.update();
  assert.equal(removed.userData.witchHat, undefined);
  assert.ok(desk.clawds[0].userData.witchHat);
  const face = worker.userData.skin[0];
  face.material = face.material.clone(); face.material.transparent = true; face.material.opacity = .4;
  const fadingMaterial = face.material;
  desks.clear();
  costumes.update();
  assert.equal(face.material, fadingMaterial);
  assert.equal(face.material.opacity, .4);
  assert.ok(face.material.color.equals(skinColor));
  assert.equal(desk.clawds[0].userData.witchHat, undefined);
  costumes.dispose();
  fadingMaterial.dispose();
});

test('each subagent gets its own provider model, retaining positions and animations across polls', async t => {
  const { THREE, syncClawds, animateClawd } = await modules(t);
  const desk = { group: new THREE.Group(), worker: { obj: new THREE.Group() }, session: { provider: 'claude' }, clawds: [] };
  const agents = [{ type: 'Explore' }, { provider: 'codex' }, { type: 'Codex' }];
  syncClawds(desk, agents);
  assert.deepEqual(desk.clawds.map(c => c.userData.kind), ['claude', 'codex', 'codex']);
  const existing = [...desk.clawds];
  syncClawds(desk, agents);
  assert.deepEqual(desk.clawds, existing);
  for (const companion of desk.clawds) {
    for (const now of [0, 1000, 4000, 20000]) animateClawd(companion, now);
    const size = new THREE.Box3().setFromObject(companion).getSize(new THREE.Vector3());
    assert.ok(size.x > .2 && size.x < .9 && size.y > .2 && size.y < .8, 'fits a laptop-side companion spot');
    assert.ok(companion.position.toArray().every(Number.isFinite));
    assert.equal(Object.values(companion.userData.faces).filter(f => f.visible).length, 1);
  }
  syncClawds(desk, [{ provider: 'codex' }]);
  assert.equal(desk.clawds[0].userData.kind, 'codex');
  assert.equal(existing[0].parent, null);
  assert.equal(existing[1].parent, null);
  syncClawds(desk, []);
  assert.equal(desk.group.children.length, 0);
});

test('the first subagent expression change hides the original eyes for both providers', async t => {
  const { THREE, syncClawds, animateClawd } = await modules(t);
  t.mock.method(Math, 'random', () => .99);
  const desk = { group: new THREE.Group(), worker: { obj: new THREE.Group() }, session: { provider: 'claude' }, clawds: [] };
  syncClawds(desk, [{ provider: 'claude' }, { provider: 'codex' }]);
  for (const companion of desk.clawds) {
    animateClawd(companion, 1);
    assert.equal(Object.values(companion.userData.faces).filter(f => f.visible).length, 1);
    assert.equal(companion.userData.faces.dot.visible, true);
  }
});

test('Codex parent supplies the default model and keeps the existing spot limit and head rider', async t => {
  const { THREE, syncClawds } = await modules(t);
  const desk = { group: new THREE.Group(), worker: { obj: new THREE.Group() }, session: { provider: 'codex' }, clawds: [] };
  syncClawds(desk, Array.from({ length: 20 }, () => ({})));
  assert.equal(desk.clawds.length, 12);
  assert.ok(desk.clawds.every(c => c.userData.kind === 'codex'));
  assert.equal(desk.clawds[6].parent, desk.worker.obj);
  syncClawds(desk, []);
  assert.equal(desk.worker.obj.children.length, 0);
});

test('worker hair and shirts stay in their palettes even when a session hash has its sign bit set', async t => {
  const { person, hash, HAIR, SHIRT } = await modules(t);
  const seeds = ['codex-01a15934-cb5e-7781-917e-9c30832d4a76', ...Array.from({ length: 40 }, (_, i) => 'session-' + i)];
  assert.ok(seeds.some(seed => hash(seed) >= 0x80000000), 'covers unsigned hashes that signed shifts turn negative');
  for (const seed of seeds) {
    const worker = person(seed);
    const torso = worker.children.find(c => c.isMesh);
    const hair = worker.userData.head.children[1];
    assert.ok(SHIRT.includes(torso.material.color.getHex()), `${seed}: shirt uses a real palette color`);
    assert.ok(HAIR.includes(hair.material.color.getHex()), `${seed}: hair uses a real palette color`);
    assert.equal(torso.material.isMeshLambertMaterial, true);
    assert.equal(hair.material.isMeshLambertMaterial, true);
  }
  const visitor = person('visitor', 0x3b82f6);
  assert.equal(visitor.children.find(c => c.isMesh).material.color.getHex(), 0x3b82f6);
});

test('monitor fill light follows its desk, switches with the theme, and unregisters without changing screen colors', async t => {
  const previousDocument = global.document;
  global.document = { documentElement: { dataset: {} } };
  t.after(() => { if (previousDocument === undefined) delete global.document; else global.document = previousDocument; });
  const { THREE, createMonitorLight, addThemedLight, initThemeToggle } = await modules(t);
  const desk = new THREE.Group(), lid = new THREE.Group(); desk.add(lid);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x223040 }));
  lid.add(screen); screen.position.set(0, .395, .04);
  const entry = createMonitorLight(screen), light = entry.light;
  assert.equal(light.parent, lid);
  assert.equal(light.castShadow, false);
  assert.ok(light.position.z > screen.position.z, 'light is on the worker-facing side of the monitor');
  const before = light.getWorldPosition(new THREE.Vector3());
  desk.position.set(10, 13, -600);
  const after = light.getWorldPosition(new THREE.Vector3());
  assert.deepEqual(after.sub(before).toArray(), [10, 13, -600]);
  const untrack = addThemedLight(entry), button = {};
  initThemeToggle(button);
  for (let i = 0; i < 2; i++) {
    assert.equal(light.intensity, document.documentElement.dataset.theme === 'night' ? entry.night : 0);
    assert.equal(screen.material.color.getHex(), 0x223040);
    button.onclick();
  }
  untrack();
  light.intensity = 123;
  button.onclick();
  assert.equal(light.intensity, 123, 'removed desk lights are no longer managed by theme changes');
});
