// ── Unit tests: src/services/bugsDashboardService.ts (no HTTP) ──────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TtlCache,
  fetchBugs,
  buildDashboardData,
  createDashboardCache,
  selectCachedBugs,
  buildAnalysisPrompt,
  PROJECTION_WEEKS,
  snapshotCounts,
  upsertSnapshot,
  recordTodaySnapshot,
  buildTimeSeriesFromSnapshots,
  buildPrioritySeriesFromSnapshots,
  buildSprintSeries,
  renderHistory,
  parseHistory,
  assembleDashboard,
} from '../../src/services/bugsDashboardService.js';

const pri = (o = {}) => ({ Blocker: 0, Critical: 0, Major: 0, Minor: 0, Trivial: 0, ...o });

const issue = (key) => ({
  key,
  fields: {
    summary: `Bug ${key}`,
    created: '2024-01-01T00:00:00.000Z',
    resolutiondate: null,
    status: { statusCategory: { key: 'new' } },
    priority: { name: 'High' },
    assignee: null,
    labels: [],
  },
});

describe('TtlCache', () => {
  it('returns the value until the TTL elapses', () => {
    const c = new TtlCache(1000);
    assert.equal(c.get(0), null);
    c.set('x', 100);
    assert.equal(c.get(500), 'x');
    assert.equal(c.get(1100), null);
  });

  it('clear() empties the cache', () => {
    const c = new TtlCache(1000);
    c.set('x', 0);
    c.clear();
    assert.equal(c.get(1), null);
  });

  it('createDashboardCache returns a usable TtlCache', () => {
    const c = createDashboardCache();
    assert.equal(c.get(), null);
    c.set({ n: 1 });
    assert.deepEqual(c.get(), { n: 1 });
  });
});

describe('fetchBugs', () => {
  const mk = (pages) => {
    const urls = [];
    let i = 0;
    return {
      urls,
      deps: {
        project: 'P',
        label: 'L',
        logInfo: () => {},
        jiraRequest: async (_m, url) => {
          urls.push(url);
          return pages[i++];
        },
      },
    };
  };

  it('paginates until total is reached and reports progress', async () => {
    const full = Array.from({ length: 100 }, (_, n) => issue(`A-${n}`));
    const { deps, urls } = mk([
      { issues: full, total: 130 },
      { issues: [issue('B-1')], total: 130 },
    ]);
    const stages = [];
    const out = await fetchBugs(false, deps, (p) => stages.push(p.stage));
    assert.equal(out.length, 101);
    assert.equal(urls.length, 2);
    assert.match(decodeURIComponent(urls[0]), /statusCategory != Done/);
    assert.match(urls[1], /startAt=100/);
    assert.deepEqual(stages, ['connecting', 'fetching', 'fetching']);
  });

  it('omits the closed filter when includeClosed is true', async () => {
    const { deps, urls } = mk([{ issues: [], total: 0 }]);
    await fetchBugs(true, deps, () => {});
    assert.doesNotMatch(decodeURIComponent(urls[0]), /statusCategory/);
  });
});

describe('buildDashboardData', () => {
  it('assembles series, items and stats', () => {
    const d = buildDashboardData([issue('A-1')]);
    assert.equal(d.bugs[0].key, 'A-1');
    assert.equal(d.stats.total, 1);
    assert.equal(d.timeSeries.length, 13 + PROJECTION_WEEKS);
    assert.ok(d.cachedAt);
  });
});

describe('selectCachedBugs', () => {
  it('returns null when the cache is stale', () => {
    assert.equal(selectCachedBugs(createDashboardCache(), ['A-1']), null);
  });

  it('filters the cached bugs by key', () => {
    const cache = createDashboardCache();
    cache.set(buildDashboardData([issue('A-1'), issue('A-2'), issue('A-3')]));
    const keys = selectCachedBugs(cache, ['A-1', 'A-2', 'A-9']).map((b) => b.key);
    assert.deepEqual(keys.sort(), ['A-1', 'A-2']);
  });

  it('returns an empty list when no requested key is cached', () => {
    const cache = createDashboardCache();
    cache.set(buildDashboardData([issue('A-1')]));
    assert.deepEqual(selectCachedBugs(cache, ['Z-1']), []);
  });
});

describe('buildAnalysisPrompt', () => {
  it('lists each bug with status, priority, assignee and resolution date', () => {
    const prompt = buildAnalysisPrompt([
      { key: 'A-1', summary: 'Crash', status: 'Open', priority: 'High', assignee: 'Ann' },
      {
        key: 'A-2',
        summary: 'Typo',
        status: 'Resolved',
        priority: 'Low',
        assignee: null,
        resolutionDate: '2024-03-05T10:00:00.000Z',
      },
    ]);
    assert.match(prompt, /Analyze these 2 selected bugs/);
    assert.match(prompt, /- A-1: Crash \[Open\] Priority: High Assignee: Ann/);
    assert.match(prompt, /- A-2: Typo \[Resolved\] Priority: Low \(Resolved: 2024-03-05\)/);
  });
});

// A done bug carrying a resolutiondate `daysAgo` before `now`.
const doneIssue = (key, daysAgo, now = Date.now()) => ({
  key,
  fields: {
    summary: `Bug ${key}`,
    created: '2024-01-01T00:00:00.000Z',
    resolutiondate: new Date(now - daysAgo * 86400000).toISOString(),
    status: { statusCategory: { key: 'done' } },
    priority: { name: 'Major' },
    assignee: null,
    labels: [],
  },
});

// An open bug with a given priority.
const openIssue = (key, priority = 'Major', cat = 'new', sprints = []) => ({
  key,
  fields: {
    summary: `Bug ${key}`,
    created: '2024-01-01T00:00:00.000Z',
    resolutiondate: null,
    status: { statusCategory: { key: cat } },
    priority: { name: priority },
    assignee: null,
    labels: [],
    customfield_10004: sprints,
  },
});

describe('snapshotCounts', () => {
  it('buckets by status and open-bug priority (Resolved only within 30 days)', () => {
    const now = Date.now();
    const bugs = [
      openIssue('OPEN-MAJOR', 'Major'),
      openIssue('OPEN-CRIT', 'Critical'),
      doneIssue('DONE-RECENT', 10, now), // resolved 10d ago -> Resolved
      doneIssue('DONE-OLD', 90, now), // resolved 90d ago -> Closed
    ];
    const c = snapshotCounts(bugs, new Date(now));
    assert.deepEqual(c, {
      Open: 2,
      'In Progress': 0,
      Resolved: 1,
      Closed: 1,
      priority: pri({ Major: 1, Critical: 1 }), // only the 2 open bugs
    });
  });

  it('buckets an unknown priority into Trivial', () => {
    const c = snapshotCounts([openIssue('X', 'Highest')]);
    assert.equal(c.priority.Trivial, 1);
  });

  it('agrees with the stats tiles (Resolved count == resolved30d)', () => {
    const now = Date.now();
    const bugs = [doneIssue('A', 5, now), doneIssue('B', 40, now)];
    const c = snapshotCounts(bugs, new Date(now));
    const stats = buildDashboardData(bugs).stats;
    assert.equal(c.Resolved, stats.resolved30d);
  });
});

describe('buildSprintSeries', () => {
  const sprintField = (name) => [
    `com.atlassian.greenhopper.service.sprint.Sprint@1[id=1,name=${name},state=CLOSED]`,
  ];
  it('counts bugs by their current (last) sprint, most-recent N, ordered', () => {
    const bugs = [
      openIssue('A', 'Major', 'new', sprintField('MIDAS Sprint 105')),
      openIssue('B', 'Major', 'new', sprintField('MIDAS Sprint 106')),
      openIssue('C', 'Major', 'new', sprintField('MIDAS Sprint 106')),
      openIssue('D', 'Major', 'new', []), // no sprint -> excluded
    ];
    const s = buildSprintSeries(bugs, 12);
    assert.deepEqual(s, [
      { sprint: 'MIDAS Sprint 105', count: 1 },
      { sprint: 'MIDAS Sprint 106', count: 2 },
    ]);
  });

  it('keeps only the most recent N sprints by number', () => {
    const bugs = [41, 42, 43].map((n) =>
      openIssue(`S${n}`, 'Major', 'new', sprintField(`MIDAS Sprint ${n}`))
    );
    const s = buildSprintSeries(bugs, 2);
    assert.deepEqual(
      s.map((x) => x.sprint),
      ['MIDAS Sprint 42', 'MIDAS Sprint 43']
    );
  });
});

describe('buildPrioritySeriesFromSnapshots', () => {
  it('maps each day to priority counts then appends a carried-forward projection', () => {
    const history = [
      {
        date: '2026-10-01',
        Open: 0,
        'In Progress': 0,
        Resolved: 0,
        Closed: 0,
        priority: pri({ Major: 3 }),
      },
      {
        date: '2026-10-08',
        Open: 0,
        'In Progress': 0,
        Resolved: 0,
        Closed: 0,
        priority: pri({ Major: 5, Blocker: 1 }),
      },
    ];
    const ps = buildPrioritySeriesFromSnapshots(history);
    assert.equal(ps.length, 2 + PROJECTION_WEEKS);
    assert.equal(ps[1].Major, 5);
    for (const p of ps.slice(2)) {
      assert.equal(p.Major, 5); // carried forward
      assert.equal(p.Blocker, 1);
    }
  });
});

describe('upsertSnapshot', () => {
  const snap = (date, open) => ({ date, Open: open, 'In Progress': 0, Resolved: 0, Closed: 0 });
  it('replaces an existing same-date row and keeps the list sorted', () => {
    let h = [snap('2026-10-01', 1), snap('2026-10-03', 3)];
    h = upsertSnapshot(h, snap('2026-10-02', 2)); // insert in the middle
    assert.deepEqual(
      h.map((s) => s.date),
      ['2026-10-01', '2026-10-02', '2026-10-03']
    );
    h = upsertSnapshot(h, snap('2026-10-02', 99)); // replace, not duplicate
    assert.equal(h.filter((s) => s.date === '2026-10-02').length, 1);
    assert.equal(h.find((s) => s.date === '2026-10-02').Open, 99);
  });
});

describe('recordTodaySnapshot', () => {
  it("adds today's row computed from current status and priority", () => {
    const now = new Date('2026-10-21T12:00:00.000Z');
    const h = recordTodaySnapshot([], [openIssue('A-1', 'Blocker')], now);
    assert.equal(h.length, 1);
    assert.equal(h[0].date, '2026-10-21');
    assert.equal(h[0].Open, 1);
    assert.equal(h[0].priority.Blocker, 1);
  });
});

describe('buildTimeSeriesFromSnapshots', () => {
  const snap = (date, vals) => ({
    date,
    Open: 0,
    'In Progress': 0,
    Resolved: 0,
    Closed: 0,
    ...vals,
  });
  it('maps history to points then appends a flat carried-forward projection', () => {
    const history = [
      snap('2026-10-01', { Open: 5, Resolved: 3 }),
      snap('2026-10-08', { Open: 4, Resolved: 7 }),
    ];
    const ts = buildTimeSeriesFromSnapshots(history);
    assert.equal(ts.length, 2 + PROJECTION_WEEKS);
    assert.ok(ts.slice(0, 2).every((p) => p.projected === false));
    assert.ok(ts.slice(2).every((p) => p.projected === true));
    for (const p of ts.slice(2)) {
      assert.equal(p.Open, 4); // carried from the last snapshot
      assert.equal(p.Resolved, 7);
    }
  });

  it('returns an empty series for empty history', () => {
    assert.deepEqual(buildTimeSeriesFromSnapshots([]), []);
  });
});

describe('history markdown round-trip', () => {
  it('renderHistory → parseHistory preserves the rows (incl. priority)', () => {
    const history = [
      {
        date: '2026-10-01',
        Open: 5,
        'In Progress': 2,
        Resolved: 3,
        Closed: 100,
        priority: pri({ Major: 5, Minor: 2 }),
      },
      {
        date: '2026-10-08',
        Open: 4,
        'In Progress': 1,
        Resolved: 7,
        Closed: 102,
        priority: pri({ Blocker: 1, Critical: 1, Major: 3 }),
      },
    ];
    assert.deepEqual(parseHistory(renderHistory(history)), history);
  });

  it('ignores the header/separator rows', () => {
    assert.deepEqual(parseHistory(renderHistory([])), []);
  });
});

describe('assembleDashboard', () => {
  it('drives all three chart series from the passed data', () => {
    const history = [
      {
        date: '2026-10-01',
        Open: 1,
        'In Progress': 0,
        Resolved: 0,
        Closed: 0,
        priority: pri({ Major: 1 }),
      },
    ];
    const d = assembleDashboard([openIssue('A-1', 'Major')], history);
    assert.equal(d.timeSeries.length, 1 + PROJECTION_WEEKS);
    assert.equal(d.prioritySeries.length, 1 + PROJECTION_WEEKS);
    assert.ok(Array.isArray(d.sprints));
    assert.equal(d.stats.total, 1);
    assert.equal(d.bugs[0].key, 'A-1');
  });
});
