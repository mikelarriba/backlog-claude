// ── Unit tests: greedyFill ────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { greedyFill } from '../../src/services/distributionService.js';

function makeDoc(filename, overrides = {}) {
  return {
    filename,
    docType: 'story',
    title: filename,
    storyPoints: 3,
    hasEstimate: true,
    priority: 'Medium',
    sprint: null,
    rank: 1,
    parentFilename: null,
    blockedBy: [],
    blocks: [],
    parallel: [],
    ...overrides,
  };
}

function makeBucket(name, idx, capacity) {
  return {
    name,
    capacity,
    effectiveCapacity: capacity,
    idx,
    assigned: [],
    usedPoints: 0,
  };
}

describe('greedyFill — basic capacity fill', () => {
  test('places doc in first bucket that fits', () => {
    const workQueue = [makeDoc('a.md', { storyPoints: 3 })];
    const buckets = [makeBucket('S1', 0, 10), makeBucket('S2', 1, 10)];
    const { overflow, warnings } = greedyFill(workQueue, buckets, new Map(), new Map());
    assert.equal(overflow.length, 0);
    assert.equal(buckets[0].assigned.length, 1);
    assert.equal(buckets[1].assigned.length, 0);
    assert.equal(warnings.length, 0);
  });

  test('overflows doc that does not fit in any bucket', () => {
    const workQueue = [makeDoc('a.md', { storyPoints: 15 })];
    const buckets = [makeBucket('S1', 0, 10)];
    const { overflow } = greedyFill(workQueue, buckets, new Map(), new Map());
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].filename, 'a.md');
  });

  test('fills second bucket when first is full', () => {
    const workQueue = [makeDoc('a.md', { storyPoints: 8 }), makeDoc('b.md', { storyPoints: 5 })];
    const buckets = [makeBucket('S1', 0, 10), makeBucket('S2', 1, 10)];
    const { overflow } = greedyFill(workQueue, buckets, new Map(), new Map());
    assert.equal(overflow.length, 0);
    assert.equal(buckets[0].assigned.length, 1);
    assert.equal(buckets[1].assigned.length, 1);
  });
});

describe('greedyFill — dependency ordering', () => {
  test('blocked doc goes to later sprint than its blocker', () => {
    const _blocker = makeDoc('blocker.md', { storyPoints: 3 });
    const blocked = makeDoc('blocked.md', { storyPoints: 3, blockedBy: ['blocker.md'] });
    const buckets = [makeBucket('S1', 0, 10), makeBucket('S2', 1, 10)];
    const placementMap = new Map([['blocker.md', 'S1']]);
    const { overflow, warnings } = greedyFill([blocked], buckets, placementMap, new Map());
    assert.equal(overflow.length, 0);
    assert.equal(buckets[1].assigned.length, 1);
    assert.ok(warnings.some((w) => w.kind === 'DEPENDENCY_VIOLATION'));
  });

  test('unblocked doc can go in first sprint', () => {
    const doc = makeDoc('free.md', { storyPoints: 3 });
    const buckets = [makeBucket('S1', 0, 10)];
    const { overflow, warnings } = greedyFill([doc], buckets, new Map(), new Map());
    assert.equal(overflow.length, 0);
    assert.equal(warnings.filter((w) => w.kind === 'DEPENDENCY_VIOLATION').length, 0);
  });
});

describe('greedyFill — epic window', () => {
  test('emits EPIC_WINDOW_EXCEEDED when doc spills beyond 2-sprint window', () => {
    const doc = makeDoc('story.md', {
      storyPoints: 5,
      parentFilename: 'epic.md',
    });
    const buckets = [
      makeBucket('S1', 0, 3), // full: epic starts here (idx 0), window = 0,1
      makeBucket('S2', 1, 3), // full
      makeBucket('S3', 2, 10), // spill target
    ];
    // Pre-fill S1 and S2 so the doc must spill to S3
    buckets[0].usedPoints = 3;
    buckets[1].usedPoints = 3;
    const epicStartSprint = new Map([['epic.md', 0]]);
    const { overflow, warnings } = greedyFill([doc], buckets, new Map(), epicStartSprint);
    assert.equal(overflow.length, 0);
    assert.ok(warnings.some((w) => w.kind === 'EPIC_WINDOW_EXCEEDED'));
  });
});

describe('greedyFill — empty input', () => {
  test('returns empty overflow and warnings for empty queue', () => {
    const { overflow, warnings } = greedyFill([], [], new Map(), new Map());
    assert.equal(overflow.length, 0);
    assert.equal(warnings.length, 0);
  });
});
