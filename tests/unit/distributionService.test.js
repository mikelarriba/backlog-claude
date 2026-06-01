// ── Unit tests for distributionService.proposeDistribution ───────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeDistribution } from '../../src/services/distributionService.js';

function makeDoc(overrides = {}) {
  return {
    filename: 'story.md',
    docType: 'story',
    title: 'A Story',
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

const EMPTY_EPIC_MAP = new Map();

describe('proposeDistribution — empty input', () => {
  test('returns empty sprints and overflow when no docs', () => {
    const result = proposeDistribution([], [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    assert.equal(result.sprints.length, 1);
    assert.equal(result.sprints[0].assigned.length, 0);
    assert.equal(result.overflow.length, 0);
  });

  test('returns empty when no sprints configured', () => {
    const docs = [makeDoc()];
    const result = proposeDistribution(docs, [], EMPTY_EPIC_MAP);
    assert.equal(result.sprints.length, 0);
    assert.equal(result.overflow.length, 1);
  });
});

describe('proposeDistribution — single sprint', () => {
  test('places docs that fit within capacity', () => {
    const docs = [makeDoc({ filename: 'a.md', storyPoints: 3 }), makeDoc({ filename: 'b.md', storyPoints: 5 })];
    const result = proposeDistribution(docs, [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    assert.equal(result.sprints[0].assigned.length, 2);
    assert.equal(result.overflow.length, 0);
  });

  test('overflows docs that exceed capacity', () => {
    const docs = [makeDoc({ filename: 'a.md', storyPoints: 8 }), makeDoc({ filename: 'b.md', storyPoints: 5 })];
    const result = proposeDistribution(docs, [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    assert.equal(result.sprints[0].assigned.length, 1);
    assert.equal(result.overflow.length, 1);
  });

  test('items with no estimate go to overflow with a warning', () => {
    const docs = [makeDoc({ storyPoints: 0, hasEstimate: false })];
    const result = proposeDistribution(docs, [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    assert.equal(result.overflow.length, 1);
    assert.ok(result.warnings.some(w => w.includes('no story point estimate')));
  });
});

describe('proposeDistribution — dependency ordering', () => {
  test('blocked doc is placed in a later sprint than its blocker', () => {
    const blocker = makeDoc({ filename: 'blocker.md', storyPoints: 3, blocks: ['blocked.md'] });
    const blocked = makeDoc({ filename: 'blocked.md', storyPoints: 3, blockedBy: ['blocker.md'] });
    const sprints = [{ name: 'S1', capacity: 10 }, { name: 'S2', capacity: 10 }];
    const result = proposeDistribution([blocker, blocked], sprints, EMPTY_EPIC_MAP);

    const placement = new Map(
      result.sprints.flatMap(s => s.assigned.map(d => [d.filename, s.name]))
    );
    const blockerSprint = result.sprints.findIndex(s => s.assigned.some(d => d.filename === 'blocker.md'));
    const blockedSprint = result.sprints.findIndex(s => s.assigned.some(d => d.filename === 'blocked.md'));
    assert.ok(blockedSprint > blockerSprint, `blocked (sprint ${blockedSprint}) should come after blocker (sprint ${blockerSprint})`);
    void placement; // suppress unused warning
  });

  test('blocker already assigned: respects its sprint when placing the blocked doc', () => {
    const blocker = makeDoc({ filename: 'blocker.md', storyPoints: 3, sprint: 'S1', blocks: ['blocked.md'] });
    const blocked = makeDoc({ filename: 'blocked.md', storyPoints: 3, blockedBy: ['blocker.md'] });
    const sprints = [{ name: 'S1', capacity: 10 }, { name: 'S2', capacity: 10 }];
    const result = proposeDistribution([blocker, blocked], sprints, EMPTY_EPIC_MAP);

    const blockedBucket = result.sprints.find(s => s.assigned.some(d => d.filename === 'blocked.md'));
    assert.equal(blockedBucket?.name, 'S2');
  });
});

describe('proposeDistribution — parallel co-location', () => {
  test('parallel siblings are placed in the same sprint when possible', () => {
    const a = makeDoc({ filename: 'a.md', storyPoints: 2, parallel: ['b.md'] });
    const b = makeDoc({ filename: 'b.md', storyPoints: 2, parallel: ['a.md'] });
    const sprints = [{ name: 'S1', capacity: 10 }, { name: 'S2', capacity: 10 }];
    const result = proposeDistribution([a, b], sprints, EMPTY_EPIC_MAP);
    const inS1 = result.sprints[0].assigned.map(d => d.filename);
    assert.ok(inS1.includes('a.md') && inS1.includes('b.md'), 'both parallel stories should be in S1');
  });

  test('warns when parallel siblings cannot be co-located', () => {
    const a = makeDoc({ filename: 'a.md', storyPoints: 9, parallel: ['b.md'] });
    const b = makeDoc({ filename: 'b.md', storyPoints: 9, parallel: ['a.md'] });
    const sprints = [{ name: 'S1', capacity: 10 }, { name: 'S2', capacity: 10 }];
    const result = proposeDistribution([a, b], sprints, EMPTY_EPIC_MAP);
    assert.ok(result.warnings.some(w => w.includes('could not be co-located')));
  });
});

describe('proposeDistribution — over-capacity sprints', () => {
  test('includes a suggestion when a sprint is under 50% capacity', () => {
    const doc = makeDoc({ storyPoints: 2 });
    const result = proposeDistribution([doc], [{ name: 'S1', capacity: 20 }], EMPTY_EPIC_MAP);
    assert.ok(result.suggestions.some(s => s.includes('free capacity')));
  });

  test('reports total overflow SP in the warning message', () => {
    const docs = [
      makeDoc({ filename: 'a.md', storyPoints: 8 }),
      makeDoc({ filename: 'b.md', storyPoints: 8 }),
    ];
    const result = proposeDistribution(docs, [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    assert.ok(result.warnings.some(w => w.includes('exceed total sprint capacity')));
  });
});

describe('proposeDistribution — already-assigned docs', () => {
  test('pre-assigned docs appear with wasAlreadyAssigned=true and consume capacity', () => {
    const already = makeDoc({ filename: 'old.md', storyPoints: 5, sprint: 'S1' });
    const fresh   = makeDoc({ filename: 'new.md', storyPoints: 6 });
    const result  = proposeDistribution([already, fresh], [{ name: 'S1', capacity: 10 }], EMPTY_EPIC_MAP);
    const s1 = result.sprints[0];
    const oldEntry = s1.assigned.find(d => d.filename === 'old.md');
    assert.ok(oldEntry?.wasAlreadyAssigned);
    // fresh needs 6 SP but only 5 remain → goes to overflow
    assert.equal(result.overflow.find(d => d.filename === 'new.md')?.filename, 'new.md');
  });
});
