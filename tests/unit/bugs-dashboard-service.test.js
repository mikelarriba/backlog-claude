// ── Unit tests: src/services/bugsDashboardService.ts (no HTTP) ──────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TtlCache,
  fetchBugs,
  buildDashboardData,
  createDashboardCaches,
  selectCachedBugs,
  buildAnalysisPrompt,
} from '../../src/services/bugsDashboardService.js';

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

  it('createDashboardCaches gives independent open/all caches', () => {
    const c = createDashboardCaches();
    c.open.set({ n: 1 });
    assert.equal(c.all.get(), null);
    assert.deepEqual(c.open.get(), { n: 1 });
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
    assert.equal(d.timeSeries.length, 13 + 52);
    assert.ok(d.cachedAt);
  });
});

describe('selectCachedBugs', () => {
  it('returns null when neither cache is fresh', () => {
    assert.equal(selectCachedBugs(createDashboardCaches(), ['A-1']), null);
  });

  it('merges open and all caches, de-duplicates and filters by key', () => {
    const caches = createDashboardCaches();
    caches.open.set(buildDashboardData([issue('A-1'), issue('A-2')]));
    caches.all.set(buildDashboardData([issue('A-2'), issue('A-3')]));
    const keys = selectCachedBugs(caches, ['A-1', 'A-2', 'A-3', 'A-9']).map((b) => b.key);
    assert.deepEqual(keys.sort(), ['A-1', 'A-2', 'A-3']);
  });

  it('returns an empty list when no requested key is cached', () => {
    const caches = createDashboardCaches();
    caches.open.set(buildDashboardData([issue('A-1')]));
    assert.deepEqual(selectCachedBugs(caches, ['Z-1']), []);
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
