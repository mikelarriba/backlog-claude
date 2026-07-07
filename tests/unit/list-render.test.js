// ── Unit tests: public/js/list-render.js ───────────────────────────────────────
// Pure tree-order, swimlane-categorization, readiness-scoring, and rank-position
// helpers used by the list view — exercised here without a DOM/browser (#347).
import '../helpers/domGlobals.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTreeOrder,
  categorizeDocs,
  computeReadiness,
  computeRankPositions,
  _rankSortFn,
} from '../../public/js/list-render.js';

function makeDoc(overrides = {}) {
  return {
    filename: 'doc.md',
    docType: 'story',
    title: 'A Story',
    date: '2024-01-01',
    status: 'Draft',
    fixVersion: null,
    jiraId: null,
    jiraUrl: null,
    storyPoints: null,
    sprint: null,
    rank: null,
    priority: 'Medium',
    parentFilename: null,
    parentType: null,
    blocks: [],
    blockedBy: [],
    parallel: [],
    pi: null,
    team: null,
    workCategory: null,
    hasDescription: false,
    descriptionSnippet: null,
    ...overrides,
  };
}

// ── _rankSortFn ────────────────────────────────────────────────────────────────
describe('_rankSortFn', () => {
  test('orders by rank ascending when both have a rank', () => {
    const a = makeDoc({ filename: 'a.md', rank: 2 });
    const b = makeDoc({ filename: 'b.md', rank: 1 });
    assert.ok(_rankSortFn(a, b) > 0);
    assert.ok(_rankSortFn(b, a) < 0);
  });

  test('a doc with a rank always sorts before one without', () => {
    const ranked = makeDoc({ filename: 'a.md', rank: 5 });
    const unranked = makeDoc({ filename: 'b.md', rank: null });
    assert.ok(_rankSortFn(ranked, unranked) < 0);
    assert.ok(_rankSortFn(unranked, ranked) > 0);
  });

  test('falls back to filename date-desc when neither has a rank', () => {
    const a = makeDoc({ filename: '2024-01-01-a.md', rank: null });
    const b = makeDoc({ filename: '2024-02-01-b.md', rank: null });
    // b.filename.localeCompare(a.filename) shape — later dates sort first
    assert.ok(_rankSortFn(a, b) > 0);
  });
});

// ── computeRankPositions ─────────────────────────────────────────────────────────
describe('computeRankPositions', () => {
  test('assigns index/total per docType group, ranked docs first', () => {
    const docs = [
      makeDoc({ filename: 'story-b.md', docType: 'story', rank: 2 }),
      makeDoc({ filename: 'story-a.md', docType: 'story', rank: 1 }),
      makeDoc({ filename: 'epic-a.md', docType: 'epic', rank: null }),
    ];
    const positions = computeRankPositions(docs);
    assert.equal(positions.get('story-a.md').index, 0);
    assert.equal(positions.get('story-a.md').total, 2);
    assert.equal(positions.get('story-b.md').index, 1);
    assert.equal(positions.get('epic-a.md').index, 0);
    assert.equal(positions.get('epic-a.md').total, 1);
  });

  test('empty input clears and returns an empty map', () => {
    const positions = computeRankPositions([]);
    assert.equal(positions.size, 0);
  });

  test('a second call replaces the results of a prior call rather than accumulating', () => {
    computeRankPositions([makeDoc({ filename: 'stale.md', docType: 'story' })]);
    const positions = computeRankPositions([makeDoc({ filename: 'fresh.md', docType: 'story' })]);
    assert.equal(positions.has('stale.md'), false);
    assert.equal(positions.has('fresh.md'), true);
  });
});

// ── buildTreeOrder ────────────────────────────────────────────────────────────
describe('buildTreeOrder', () => {
  test('places children directly after their parent, indented', () => {
    const parent = makeDoc({ filename: 'epic.md', docType: 'epic' });
    const child = makeDoc({ filename: 'story.md', docType: 'story', parentFilename: 'epic.md' });
    const { ordered } = buildTreeOrder([parent, child]);
    assert.deepEqual(
      ordered.map((o) => [o.doc.filename, o.indent]),
      [
        ['epic.md', 0],
        ['story.md', 1],
      ]
    );
  });

  test('treats a doc whose parentFilename points outside the set as a root (orphan)', () => {
    const orphan = makeDoc({ filename: 'story.md', parentFilename: 'missing-parent.md' });
    const { ordered } = buildTreeOrder([orphan]);
    assert.deepEqual(
      ordered.map((o) => [o.doc.filename, o.indent]),
      [['story.md', 0]]
    );
  });

  test('hides (does not list) children of a collapsed parent when a collapsed set is passed', () => {
    const parent = makeDoc({ filename: 'epic.md', docType: 'epic' });
    const child = makeDoc({ filename: 'story.md', parentFilename: 'epic.md' });
    const { ordered } = buildTreeOrder([parent, child], new Set(['epic.md']));
    assert.deepEqual(
      ordered.map((o) => o.doc.filename),
      ['epic.md']
    );
  });
});

// ── categorizeDocs ────────────────────────────────────────────────────────────
describe('categorizeDocs', () => {
  test('splits docs into currentPi/nextPi/backlog by fixVersion', () => {
    const docs = [
      makeDoc({ filename: 'a.md', fixVersion: 'PI-1' }),
      makeDoc({ filename: 'b.md', fixVersion: 'PI-2' }),
      makeDoc({ filename: 'c.md', fixVersion: 'PI-3' }),
      makeDoc({ filename: 'd.md', fixVersion: null }),
    ];
    const { currentPi, nextPi, backlog } = categorizeDocs(docs, {
      currentPi: 'PI-1',
      nextPi: 'PI-2',
    });
    assert.deepEqual(
      currentPi.map((d) => d.filename),
      ['a.md']
    );
    assert.deepEqual(
      nextPi.map((d) => d.filename),
      ['b.md']
    );
    assert.deepEqual(
      backlog.map((d) => d.filename),
      ['c.md', 'd.md']
    );
  });

  test('everything lands in backlog when no PI is configured', () => {
    const docs = [makeDoc({ filename: 'a.md', fixVersion: 'PI-1' })];
    const { currentPi, nextPi, backlog } = categorizeDocs(docs, {
      currentPi: null,
      nextPi: null,
    });
    assert.equal(currentPi.length, 0);
    assert.equal(nextPi.length, 0);
    assert.equal(backlog.length, 1);
  });

  test('empty doc list returns three empty arrays', () => {
    const result = categorizeDocs([], { currentPi: 'PI-1', nextPi: 'PI-2' });
    assert.deepEqual(result, { currentPi: [], nextPi: [], backlog: [] });
  });
});

// ── computeReadiness ──────────────────────────────────────────────────────────
describe('computeReadiness', () => {
  test('a leaf story with story points and a description is 100% ready', () => {
    const doc = makeDoc({
      filename: 's.md',
      docType: 'story',
      storyPoints: 3,
      hasDescription: true,
    });
    const childrenMap = new Map();
    const docsMap = new Map([['s.md', doc]]);
    assert.equal(computeReadiness(doc, childrenMap, docsMap), 100);
  });

  test('a leaf story missing story points and description scores 0%', () => {
    const doc = makeDoc({
      filename: 's.md',
      docType: 'story',
      storyPoints: null,
      hasDescription: false,
    });
    const childrenMap = new Map();
    const docsMap = new Map([['s.md', doc]]);
    assert.equal(computeReadiness(doc, childrenMap, docsMap), 0);
  });

  test('an epic with no children scores 0 on the "has children" factor', () => {
    const epic = makeDoc({ filename: 'e.md', docType: 'epic', hasDescription: true });
    const childrenMap = new Map();
    const docsMap = new Map([['e.md', epic]]);
    // With no children, getAllLeaves('e.md') falls back to treating the epic
    // itself as its own single "leaf" for SP-coverage purposes.
    // scores: [hasChildren=0, SP coverage=0 (epic itself has no storyPoints), hasDescription=1]
    // -> avg = 1/3 -> 33.33%
    assert.ok(Math.abs(computeReadiness(epic, childrenMap, docsMap) - 100 / 3) < 1e-9);
  });

  test("an epic's SP coverage score reflects the fraction of leaf descendants with story points", () => {
    const epic = makeDoc({ filename: 'e.md', docType: 'epic', hasDescription: false });
    const leafWithSp = makeDoc({
      filename: 'l1.md',
      docType: 'story',
      parentFilename: 'e.md',
      storyPoints: 2,
    });
    const leafWithoutSp = makeDoc({
      filename: 'l2.md',
      docType: 'story',
      parentFilename: 'e.md',
      storyPoints: null,
    });
    const childrenMap = new Map([['e.md', [leafWithSp, leafWithoutSp]]]);
    const docsMap = new Map([
      ['e.md', epic],
      ['l1.md', leafWithSp],
      ['l2.md', leafWithoutSp],
    ]);
    // scores: [hasChildren=1, SP coverage=0.5, hasDescription=0] -> avg -> 50
    assert.equal(computeReadiness(epic, childrenMap, docsMap), 50);
  });
});
