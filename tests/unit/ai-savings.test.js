// ── Unit tests: public/js/ai-savings.js ─────────────────────────────────────
// Pure time-window helpers backing the "AI Time Saved" dashboard (#460):
// _filterByRange narrows logged entries to a week/month/all window, and
// _weekLabel/_startOfWeek/_endOfWeek back the per-week chart bucketing.
// ai-savings.js statically imports state.js, which wires several globals onto
// `window` via Object.defineProperty at module load time — so the domGlobals
// shim (aliasing window to globalThis) must be imported first, same as
// list-render.test.js and friends.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { _filterByRange, _weekLabel, _startOfWeek, _endOfWeek } =
  await import('../../public/js/ai-savings.js');

function entryAt(timestamp) {
  return {
    id: 't',
    timestamp,
    action_type: 'story_push',
    item_count: 1,
    jira_keys: [],
    time_saved_minutes: 5,
    notes: '',
  };
}

const DAY = 24 * 60 * 60 * 1000;

// ── _filterByRange ───────────────────────────────────────────────────────
describe('_filterByRange()', () => {
  test('"all" returns every entry unchanged, regardless of age', () => {
    const entries = [entryAt(new Date(0).toISOString()), entryAt(new Date().toISOString())];
    assert.deepEqual(_filterByRange(entries, 'all'), entries);
  });

  test('"all" on an empty list returns an empty list', () => {
    assert.deepEqual(_filterByRange([], 'all'), []);
  });

  test('"week" keeps entries from the last 7 days and drops older ones', () => {
    const now = Date.now();
    const entries = [
      entryAt(new Date(now - 1 * DAY).toISOString()),
      entryAt(new Date(now - 6 * DAY).toISOString()),
      entryAt(new Date(now - 8 * DAY).toISOString()),
      entryAt(new Date(now - 30 * DAY).toISOString()),
    ];
    const filtered = _filterByRange(entries, 'week');
    assert.equal(filtered.length, 2);
  });

  test('"week" includes an entry exactly at the 7-day cutoff (inclusive lower bound)', () => {
    const now = Date.now();
    const entries = [entryAt(new Date(now - 7 * DAY).toISOString())];
    assert.equal(_filterByRange(entries, 'week').length, 1);
  });

  test('"month" keeps entries from the last 30 days and drops older ones', () => {
    const now = Date.now();
    const entries = [
      entryAt(new Date(now - 10 * DAY).toISOString()),
      entryAt(new Date(now - 29 * DAY).toISOString()),
      entryAt(new Date(now - 31 * DAY).toISOString()),
      entryAt(new Date(now - 365 * DAY).toISOString()),
    ];
    const filtered = _filterByRange(entries, 'month');
    assert.equal(filtered.length, 2);
  });

  test('"month" includes an entry exactly at the 30-day cutoff (inclusive lower bound)', () => {
    const now = Date.now();
    const entries = [entryAt(new Date(now - 30 * DAY).toISOString())];
    assert.equal(_filterByRange(entries, 'month').length, 1);
  });

  test('an empty list stays empty for "week" and "month"', () => {
    assert.deepEqual(_filterByRange([], 'week'), []);
    assert.deepEqual(_filterByRange([], 'month'), []);
  });

  test('a future-dated entry is kept by "week" and "month" (cutoff is a lower bound only)', () => {
    const now = Date.now();
    const entries = [entryAt(new Date(now + 5 * DAY).toISOString())];
    assert.equal(_filterByRange(entries, 'week').length, 1);
    assert.equal(_filterByRange(entries, 'month').length, 1);
  });
});

// ── _weekLabel ────────────────────────────────────────────────────────────
describe('_weekLabel()', () => {
  test('the 1st of the month is week 1', () => {
    assert.equal(_weekLabel(new Date(2026, 7, 1)), 'W1 Aug');
  });

  test('the 7th of the month is still week 1 (ceil(7/7) === 1)', () => {
    assert.equal(_weekLabel(new Date(2026, 7, 7)), 'W1 Aug');
  });

  test('the 8th of the month rolls over to week 2', () => {
    assert.equal(_weekLabel(new Date(2026, 7, 8)), 'W2 Aug');
  });

  test('the last day of a 31-day month is week 5', () => {
    assert.equal(_weekLabel(new Date(2026, 7, 31)), 'W5 Aug');
  });

  test('formats the short month name for a different month', () => {
    assert.equal(_weekLabel(new Date(2026, 0, 15)), 'W3 Jan');
  });
});

// ── _startOfWeek ──────────────────────────────────────────────────────────
describe('_startOfWeek()', () => {
  test('returns midnight, 6 days before the given date (a 7-day inclusive window)', () => {
    const start = _startOfWeek(new Date(2026, 7, 21, 15, 30, 0));
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 7);
    assert.equal(start.getDate(), 15);
    assert.equal(start.getHours(), 0);
    assert.equal(start.getMinutes(), 0);
    assert.equal(start.getSeconds(), 0);
    assert.equal(start.getMilliseconds(), 0);
  });

  test('rolls back across a month boundary', () => {
    const start = _startOfWeek(new Date(2026, 7, 3));
    assert.equal(start.getMonth(), 6); // July
    assert.equal(start.getDate(), 28);
  });

  test('does not mutate the date passed in', () => {
    const d = new Date(2026, 7, 21, 15, 30, 0);
    const before = d.getTime();
    _startOfWeek(d);
    assert.equal(d.getTime(), before);
  });
});

// ── _endOfWeek ────────────────────────────────────────────────────────────
describe('_endOfWeek()', () => {
  test('returns 23:59:59.999 on the same calendar day as the given date', () => {
    const end = _endOfWeek(new Date(2026, 7, 21, 9, 0, 0));
    assert.equal(end.getFullYear(), 2026);
    assert.equal(end.getMonth(), 7);
    assert.equal(end.getDate(), 21);
    assert.equal(end.getHours(), 23);
    assert.equal(end.getMinutes(), 59);
    assert.equal(end.getSeconds(), 59);
    assert.equal(end.getMilliseconds(), 999);
  });

  test('does not mutate the date passed in', () => {
    const d = new Date(2026, 7, 21, 9, 0, 0);
    const before = d.getTime();
    _endOfWeek(d);
    assert.equal(d.getTime(), before);
  });

  test('_startOfWeek(d) through _endOfWeek(d) spans exactly 7 days', () => {
    const d = new Date(2026, 7, 21, 12, 0, 0);
    const spanMs = _endOfWeek(d).getTime() - _startOfWeek(d).getTime() + 1;
    assert.equal(spanMs, 7 * DAY);
  });
});
