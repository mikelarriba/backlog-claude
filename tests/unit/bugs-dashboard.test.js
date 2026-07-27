// ── Unit tests: src/routes/bugs-dashboard.ts (pure changelog-replay logic) ───
// statusAtDate reconstructs a bug's status at an arbitrary past date by
// replaying sorted changelog history — exactly the kind of off-by-one/
// timezone-sensitive logic that regresses silently without a test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { statusAtDate, buildTimeSeries, buildStats } from '../../src/routes/bugs-dashboard.js';

function makeIssue({ created, statusCategory = 'new', resolutionDate = null, histories = [] }) {
  return {
    key: 'BUG-1',
    fields: {
      created,
      status: { statusCategory: { key: statusCategory } },
      resolutiondate: resolutionDate,
    },
    changelog: histories.length ? { histories } : undefined,
  };
}

describe('statusAtDate()', () => {
  test('returns __not_yet__ when target date is before creation', () => {
    const issue = makeIssue({ created: '2026-02-01T00:00:00.000Z' });
    assert.equal(statusAtDate(issue, new Date('2026-01-01T00:00:00.000Z')), '__not_yet__');
  });

  test('with no changelog, reflects current status category at any date on/after creation', () => {
    const issue = makeIssue({
      created: '2026-01-01T00:00:00.000Z',
      statusCategory: 'indeterminate',
    });
    assert.equal(statusAtDate(issue, new Date('2026-02-01T00:00:00.000Z')), 'In Progress');
  });

  test('with no changelog, a done bug resolved within 30 days of the target date is Resolved', () => {
    const issue = makeIssue({
      created: '2026-01-01T00:00:00.000Z',
      statusCategory: 'done',
      resolutionDate: '2026-02-10T00:00:00.000Z',
    });
    assert.equal(statusAtDate(issue, new Date('2026-02-15T00:00:00.000Z')), 'Resolved');
  });

  test('with no changelog, a done bug resolved more than 30 days before the target date is Closed', () => {
    const issue = makeIssue({
      created: '2026-01-01T00:00:00.000Z',
      statusCategory: 'done',
      resolutionDate: '2026-01-05T00:00:00.000Z',
    });
    assert.equal(statusAtDate(issue, new Date('2026-03-01T00:00:00.000Z')), 'Closed');
  });

  test('replays changelog transitions in order to reconstruct status at each point in time', () => {
    const issue = makeIssue({
      created: '2026-01-01T00:00:00.000Z',
      statusCategory: 'done',
      resolutionDate: '2026-01-20T00:00:00.000Z',
      histories: [
        {
          created: '2026-01-10T00:00:00.000Z',
          items: [{ field: 'status', toString: 'In Progress' }],
        },
        {
          created: '2026-01-20T00:00:00.000Z',
          items: [{ field: 'status', toString: 'Done' }],
        },
      ],
    });
    // Before the first transition: still in the original (new) category.
    assert.equal(statusAtDate(issue, new Date('2026-01-05T00:00:00.000Z')), 'Open');
    // After the first transition, before the second.
    assert.equal(statusAtDate(issue, new Date('2026-01-15T00:00:00.000Z')), 'In Progress');
    // After the second transition, within 30 days of it -> Resolved.
    assert.equal(statusAtDate(issue, new Date('2026-01-25T00:00:00.000Z')), 'Resolved');
  });

  test('ignores changelog entries that occur after the target date', () => {
    const issue = makeIssue({
      created: '2026-01-01T00:00:00.000Z',
      statusCategory: 'done',
      histories: [
        { created: '2026-02-01T00:00:00.000Z', items: [{ field: 'status', toString: 'Done' }] },
      ],
    });
    assert.equal(statusAtDate(issue, new Date('2026-01-15T00:00:00.000Z')), 'Open');
  });
});

describe('buildTimeSeries()', () => {
  test('returns 13 historical weeks followed by 52 projected weeks', () => {
    const points = buildTimeSeries([]);
    assert.equal(points.length, 65);
    assert.ok(points.slice(0, 13).every((p) => p.projected === false));
    assert.ok(points.slice(13).every((p) => p.projected === true));
  });

  test('projected weeks carry forward the last historical Open/In Progress counts', () => {
    // Created long in the past with no changelog, so this bug reads as
    // currently Open at every historical week regardless of when tests run.
    const bug = {
      key: 'BUG-1',
      fields: {
        created: '2000-01-01T00:00:00.000Z',
        status: { statusCategory: { key: 'new' } },
        resolutiondate: null,
      },
    };
    const points = buildTimeSeries([bug]);
    const lastHistorical = points[12];
    assert.equal(lastHistorical.Open, 1);
    for (const p of points.slice(13)) {
      assert.equal(p.Open, lastHistorical.Open);
      assert.equal(p['In Progress'], lastHistorical['In Progress']);
      assert.equal(p.Resolved, 0);
      assert.equal(p.Closed, 0);
    }
  });
});

describe('buildStats()', () => {
  test('counts open bugs, resolutions in the last 30 days, and average resolution time', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const bugs = [
      {
        fields: {
          status: { statusCategory: { key: 'new' } },
          resolutiondate: null,
          created: new Date(now - 10 * day).toISOString(),
        },
      },
      {
        fields: {
          status: { statusCategory: { key: 'indeterminate' } },
          resolutiondate: null,
          created: new Date(now - 5 * day).toISOString(),
        },
      },
      {
        fields: {
          status: { statusCategory: { key: 'done' } },
          resolutiondate: new Date(now - 2 * day).toISOString(),
          created: new Date(now - 12 * day).toISOString(),
        },
      },
      {
        fields: {
          status: { statusCategory: { key: 'done' } },
          resolutiondate: new Date(now - 60 * day).toISOString(),
          created: new Date(now - 70 * day).toISOString(),
        },
      },
    ];
    const stats = buildStats(bugs);
    assert.equal(stats.total, 4);
    assert.equal(stats.open, 2);
    assert.equal(stats.resolved30d, 1);
    assert.equal(stats.avgResolutionDays, 10);
  });

  test('returns null avgResolutionDays when nothing has been resolved', () => {
    const stats = buildStats([
      {
        fields: {
          status: { statusCategory: { key: 'new' } },
          resolutiondate: null,
          created: new Date().toISOString(),
        },
      },
    ]);
    assert.equal(stats.avgResolutionDays, null);
  });
});
