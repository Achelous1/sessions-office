/**
 * Annual event interface (browser-local dates, both end days included).
 * @typedef {{ start: { month: number, day: number }, end: { month: number, day: number } }} EventPeriod
 * @typedef {{ id: string, period: EventPeriod, create: (context: object) => { update: (now: number) => void, dispose: () => void } }} SeasonalEvent
 */

export function isInEventPeriod({ start, end }, date = new Date()) {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  const from = start.month * 100 + start.day, to = end.month * 100 + end.day;
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

/** @param {SeasonalEvent[]} definitions */
export function createSeasonalEvents(definitions) {
  const active = new Map();
  let context = null, checkedDay = '';

  function sync(date) {
    if (!context) return;
    const day = date.toDateString();
    if (day === checkedDay) return;
    checkedDay = day;
    for (const event of definitions) {
      if (isInEventPeriod(event.period, date)) {
        if (!active.has(event.id)) active.set(event.id, event.create(context));
      } else if (active.has(event.id)) {
        active.get(event.id).dispose();
        active.delete(event.id);
      }
    }
  }

  function dispose() {
    for (const event of active.values()) event.dispose();
    active.clear();
    context = null;
    checkedDay = '';
  }

  return {
    rebuild(nextContext, date = new Date()) {
      dispose();
      context = nextContext;
      sync(date);
    },
    update(now, date = new Date()) {
      sync(date);
      for (const event of active.values()) event.update(now);
    },
    dispose,
  };
}
