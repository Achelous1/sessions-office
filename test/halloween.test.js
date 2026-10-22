const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Use real Three.js objects and theme code; only the browser/WebGL boundary is replaced.
async function modules(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-halloween-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, file] of Object.entries({
    three: 'vendor/three.module.js', voxel: 'js/core/voxel.js', theme: 'js/core/theme.js',
    halloween: 'js/world/halloween.js', layout: 'js/world/layout.js', 'seasonal-events': 'js/core/seasonal-events.js',
    'halloween-costumes': 'js/characters/halloween-costumes.js',
    person: 'js/characters/person.js', palette: 'js/world/palette.js',
  })) {
    const code = fs.readFileSync(path.join(__dirname, '../client', file), 'utf8')
      .replace(/from 'three'/g, "from './three.mjs'")
      .replace(/from '(?:\.\/|\.\.\/core\/|\.\.\/characters\/|\.\.\/world\/)([^/]+)\.js'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(dir, name + '.mjs'), code);
  }
  fs.writeFileSync(path.join(dir, 'engine.mjs'), `import * as THREE from './three.mjs';
    export const scene = new THREE.Scene(); scene.background = new THREE.Color();
    export const hemiLight = new THREE.HemisphereLight(); export const sunLight = new THREE.DirectionalLight();`);
  const load = name => import(pathToFileURL(path.join(dir, name + '.mjs')));
  return { THREE: await load('three'), ...await load('halloween'), ...await load('theme'), ...await load('layout'), ...await load('seasonal-events'), ...await load('person') };
}

test('costumes share the event period and survive room rebuilds without retaining zombie skin', async t => {
  const { THREE, person, halloweenEvent, layout, L, createSeasonalEvents } = await modules(t);
  layout(0);
  const visitor = { obj: person('visitor') }, worker = person('worker');
  const originalSkin = worker.userData.skin.map(mesh => mesh.material);
  const desks = new Map([['worker', { worker: { obj: worker }, clawds: [] }]]);
  const context = { parent: new THREE.Group(), walls: { back: new THREE.Group(), front: new THREE.Group() }, bounds: { ...L }, visitor, desks };
  const events = createSeasonalEvents([halloweenEvent]);
  const active = new Date(2026, 10, 1, 23, 59, 59);
  events.rebuild(context, new Date(2026, 9, 19));
  events.update(0, active);
  assert.ok(visitor.obj.userData.witchHat);
  assert.notEqual(worker.userData.skin[0].material, originalSkin[0]);
  const oldHat = visitor.obj.userData.witchHat;
  events.rebuild(context, active);
  events.update(1, active);
  assert.equal(oldHat.parent, null);
  assert.ok(visitor.obj.userData.witchHat);
  const arriving = person('arriving');
  desks.set('arriving', { worker: { obj: arriving }, clawds: [] });
  events.update(2, active);
  assert.ok(arriving.userData.head.getObjectByName('halloween-zombie'));
  events.update(3, new Date(2026, 10, 2));
  assert.equal(visitor.obj.userData.witchHat, undefined);
  assert.deepEqual(worker.userData.skin.map(mesh => mesh.material), originalSkin);
  assert.equal(arriving.userData.head.getObjectByName('halloween-zombie'), undefined);
  events.dispose();
});

test('Halloween decor animates outside every room size and releases only its own resources', async t => {
  const { THREE, halloweenEvent, layout, L } = await modules(t);
  for (const count of [0, 16, 60]) {
    layout(count);
    const parent = new THREE.Group(), back = new THREE.Group(), front = new THREE.Group();
    parent.add(back, front);
    const event = halloweenEvent.create({ parent, walls: { back, front }, bounds: { ...L } });
    const ghosts = [], candles = [], lights = [], resources = new Set(), ownedMaterials = new Set();
    parent.traverse(o => {
      if (o.name === 'halloween-ghost') ghosts.push(o);
      if (o.name === 'halloween-candle') candles.push(o);
      if (o.isPointLight) lights.push(o);
      if (o.isMesh) resources.add(o.geometry);
      if (o.isMesh && (o.material.transparent || o.material.isMeshBasicMaterial)) ownedMaterials.add(o.material);
    });
    assert.ok(ghosts.length >= 1 && ghosts.length <= 3);
    assert.ok(candles.length > 0);
    assert.ok(lights.length > 0 && lights.length <= 4, 'pumpkins illuminate without a light per candle');
    assert.ok(back.children.length && front.children.length, 'garlands follow the cutaway walls');
    const firstY = candles[0].position.y;
    const visibility = new Set(), opacities = new Set();
    for (let now = 0; now <= 70000; now += 250) {
      event.update(now);
      visibility.add(ghosts[0].visible);
      const body = ghosts[0].children.find(c => c.isMesh);
      opacities.add(body.material.opacity);
      for (const ghost of ghosts) {
        assert.ok(ghost.position.x > L.RX + 1 || ghost.position.x < L.PX - 1 ||
          ghost.position.z > L.front + 1 || ghost.position.z < L.back - 1, 'ghost stays outside');
        assert.ok(ghost.position.toArray().every(Number.isFinite));
      }
    }
    assert.deepEqual(visibility, new Set([false, true]));
    assert.ok(opacities.size > 2, 'ghost fades instead of popping in');
    assert.notEqual(candles[0].position.y, firstY);
    let disposedGeometry = 0;
    let disposedMaterials = 0;
    resources.forEach(g => g.addEventListener('dispose', () => disposedGeometry++));
    ownedMaterials.forEach(m => m.addEventListener('dispose', () => disposedMaterials++));
    event.dispose();
    assert.deepEqual(parent.children, [back, front]);
    assert.equal(back.children.length + front.children.length, 0);
    assert.equal(disposedGeometry, 0, 'shared voxel geometry belongs to the office, not this event');
    assert.equal(disposedMaterials, ownedMaterials.size, 'every event-owned material is released');
  }
});

test('garland bats remain clear of the fairy bulbs and their glow', async t => {
  const { THREE, halloweenEvent, layout, L } = await modules(t);
  layout(8);
  const parent = new THREE.Group(), walls = { back: new THREE.Group(), front: new THREE.Group() };
  const event = halloweenEvent.create({ parent, walls, bounds: { ...L } });
  t.after(() => event.dispose());
  for (const wall of Object.values(walls)) {
    const garland = wall.getObjectByName('halloween-garland');
    const bats = garland.children.filter(o => o.isGroup);
    const bulbs = garland.children.filter(o => o.isMesh && o.material.isMeshBasicMaterial);
    assert.ok(bats.length > 0 && bulbs.length > 0, 'both bats and fairy lights are present');
    for (const bat of bats) {
      const silhouette = new THREE.Box3().setFromObject(bat);
      if (wall === walls.back && silhouette.max.x > -4.7 && silhouette.min.x < 1.7) {
        assert.ok(silhouette.min.z > L.back + 1.15, 'bats above the whiteboard hang in front of its face');
      }
      for (const bulb of bulbs) {
        assert.equal(silhouette.intersectsBox(new THREE.Box3().setFromObject(bulb)), false,
          'a bright bulb or glow must not cover a bat silhouette');
      }
    }
  }
});

test('ghosts roam all four sides continuously while bobbing, including across fade cycles', async t => {
  const { THREE, halloweenEvent, layout, L } = await modules(t);
  for (const count of [0, 60]) {
    layout(count);
    const parent = new THREE.Group();
    const event = halloweenEvent.create({ parent, walls: { back: new THREE.Group(), front: new THREE.Group() }, bounds: { ...L } });
    const ghosts = parent.getObjectsByProperty('name', 'halloween-ghost');
    const seen = ghosts.map(() => new Set()), heights = ghosts.map(() => []);
    event.update(0);
    const previous = ghosts.map(g => g.position.clone());
    for (let now = 250; now <= 600000; now += 250) {
      event.update(now);
      ghosts.forEach((g, i) => {
        assert.ok(g.position.distanceTo(previous[i]) < .6, 'drift stays smooth at loop and fade boundaries');
        previous[i].copy(g.position);
        assert.ok(g.position.x > L.RX + 1 || g.position.x < L.PX - 1 ||
          g.position.z > L.front + 1 || g.position.z < L.back - 1, 'the full route stays outside the walls');
        if (!g.visible) return;
        if (g.position.x > L.RX) seen[i].add('east');
        if (g.position.x < L.PX) seen[i].add('west');
        if (g.position.z > L.front) seen[i].add('front');
        if (g.position.z < L.back) seen[i].add('back');
        heights[i].push(g.position.y);
      });
    }
    ghosts.forEach((g, i) => {
      assert.equal(seen[i].size, 4, 'each ghost appears along every side of the office');
      assert.ok(Math.max(...heights[i]) - Math.min(...heights[i]) > .8, 'bobbing is noticeable while roaming');
    });
    event.dispose();
  }
});

test('the registered Halloween event adds and removes actual props on its inclusive boundary dates', async t => {
  const { THREE, halloweenEvent, layout, L, createSeasonalEvents } = await modules(t);
  layout(0);
  const parent = new THREE.Group(), walls = { back: new THREE.Group(), front: new THREE.Group() };
  parent.add(walls.back, walls.front);
  const events = createSeasonalEvents([halloweenEvent]);
  events.rebuild({ parent, walls, bounds: { ...L } }, new Date(2026, 9, 19, 23, 59, 59));
  for (const [date, present] of [
    [new Date(2026, 9, 19, 23, 59, 59), false], [new Date(2026, 9, 20), true],
    [new Date(2026, 10, 1, 23, 59, 59), true], [new Date(2026, 10, 2), false],
    [new Date(2027, 9, 20), true],
  ]) {
    events.update(1000, date);
    assert.equal(Boolean(parent.getObjectByName('halloween-pumpkin')), present);
    assert.equal(Boolean(walls.back.getObjectByName('halloween-garland')), present);
  }
  events.dispose();
});

test('reduced motion keeps props still and responds when the preference changes', async t => {
  const { THREE, halloweenEvent, layout, L } = await modules(t);
  const oldMatchMedia = global.matchMedia, preference = { matches: true };
  global.matchMedia = () => preference;
  t.after(() => { global.matchMedia = oldMatchMedia; });
  layout(0);
  const parent = new THREE.Group();
  const event = halloweenEvent.create({ parent, walls: { back: new THREE.Group(), front: new THREE.Group() }, bounds: { ...L } });
  t.after(() => event.dispose());
  const candle = parent.getObjectByName('halloween-candle'), ghost = parent.getObjectByName('halloween-ghost');
  event.update(0);
  const pose = [...candle.position.toArray(), ...ghost.position.toArray()];
  event.update(7000);
  assert.deepEqual([...candle.position.toArray(), ...ghost.position.toArray()], pose);
  assert.equal(ghost.visible, true);
  preference.matches = false;
  event.update(8000);
  assert.notDeepEqual([...candle.position.toArray(), ...ghost.position.toArray()], pose);
});

test('pumpkin lights follow day/night and stop receiving theme updates after event removal', async t => {
  const { THREE, halloweenEvent, layout, L, initThemeToggle } = await modules(t);
  const oldDocument = global.document;
  global.document = { documentElement: { dataset: {} } };
  t.after(() => { global.document = oldDocument; });
  const button = {};
  initThemeToggle(button);
  layout(0);
  const parent = new THREE.Group();
  const event = halloweenEvent.create({ parent, walls: { back: new THREE.Group(), front: new THREE.Group() }, bounds: { ...L } });
  const lights = []; parent.traverse(o => { if (o.isPointLight) lights.push(o); });
  for (let i = 0; i < 2; i++) {
    button.onclick();
    const night = document.documentElement.dataset.theme === 'night';
    assert.ok(lights.every(light => night ? light.intensity > 0 : light.intensity === 0));
  }
  event.dispose();
  const intensities = lights.map(light => light.intensity);
  button.onclick();
  assert.deepEqual(lights.map(light => light.intensity), intensities);
});
