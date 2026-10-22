const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '../client/js/core/seasonal-events.js');
const load = () => import('data:text/javascript;base64,' + fs.readFileSync(source).toString('base64'));
const halloween = { start: { month: 10, day: 20 }, end: { month: 11, day: 1 } };

test('Halloween includes both boundary days in local time and recurs every year', async () => {
  const { isInEventPeriod } = await load();
  for (const [date, expected] of [
    [new Date(2026, 9, 19, 23, 59, 59, 999), false],
    [new Date(2026, 9, 20), true],
    [new Date(2026, 9, 31, 23, 59), true],
    [new Date(2026, 10, 1, 23, 59, 59, 999), true],
    [new Date(2026, 10, 2), false],
    [new Date(2027, 9, 20), true],
    [new Date('invalid'), false],
  ]) assert.equal(isInEventPeriod(halloween, date), expected, String(date));
});

test('the same period interface supports Christmas across New Year and single-day events', async () => {
  const { isInEventPeriod } = await load();
  const christmas = { start: { month: 12, day: 20 }, end: { month: 1, day: 6 } };
  for (const [date, expected] of [
    [new Date(2026, 11, 19), false], [new Date(2026, 11, 20), true],
    [new Date(2026, 11, 31), true], [new Date(2027, 0, 1), true],
    [new Date(2027, 0, 6, 23, 59), true], [new Date(2027, 0, 7), false],
    [new Date(2027, 6, 1), false],
  ]) assert.equal(isInEventPeriod(christmas, date), expected, String(date));
  const oneDay = { start: { month: 12, day: 25 }, end: { month: 12, day: 25 } };
  assert.equal(isInEventPeriod(oneDay, new Date(2026, 11, 25, 23, 59)), true);
  assert.equal(isInEventPeriod(oneDay, new Date(2026, 11, 26)), false);
});

test('events start and stop at midnight without reload, rebuild once, and release their owners', async () => {
  const { createSeasonalEvents } = await load();
  const firstRoom = new Set(), secondRoom = new Set();
  const activeDay = new Date(2026, 9, 20);
  let creations = 0;
  const events = createSeasonalEvents([{
    id: 'halloween', period: halloween,
    create(room) {
      const decoration = { frame: null }; room.add(decoration); creations++;
      return { update(now) { decoration.frame = now; }, dispose() { room.delete(decoration); } };
    },
  }]);
  events.update(0, activeDay); // no room yet
  assert.equal(creations, 0);
  events.rebuild(firstRoom, new Date(2026, 9, 19));
  assert.equal(firstRoom.size, 0);
  events.update(1, activeDay);
  const decoration = [...firstRoom][0];
  assert.equal(decoration.frame, 1);
  events.update(2, activeDay);
  assert.equal([...firstRoom][0], decoration);
  assert.equal(creations, 1);
  events.rebuild(secondRoom, activeDay);
  assert.equal(firstRoom.size, 0);
  assert.equal(secondRoom.size, 1);
  assert.equal(creations, 2);
  events.update(3, new Date(2026, 10, 1, 23, 59, 59));
  assert.equal(secondRoom.size, 1);
  events.update(4, new Date(2026, 10, 2));
  assert.equal(secondRoom.size, 0);
  events.update(5, new Date(2027, 9, 20));
  assert.equal(secondRoom.size, 1);
  events.dispose();
  events.update(6, activeDay);
  assert.equal(secondRoom.size, 0);
});
