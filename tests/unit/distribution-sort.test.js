// ── Unit tests: sortByPriority ────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sortByPriority } from '../../src/services/distributionService.js';

function makeItem(overrides = {}) {
  return { rank: 1, priority: 'Medium', storyPoints: 3, ...overrides };
}

describe('sortByPriority — rank ordering', () => {
  test('lower rank comes first', () => {
    const docs = [makeItem({ rank: 2 }), makeItem({ rank: 1 })];
    sortByPriority(docs);
    assert.equal(docs[0].rank, 1);
    assert.equal(docs[1].rank, 2);
  });

  test('stable across equal rank — falls through to priority', () => {
    const docs = [makeItem({ rank: 1, priority: 'Low' }), makeItem({ rank: 1, priority: 'High' })];
    sortByPriority(docs);
    assert.equal(docs[0].priority, 'High');
    assert.equal(docs[1].priority, 'Low');
  });
});

describe('sortByPriority — priority ordering (same rank)', () => {
  test('Critical/Major sort before High', () => {
    const docs = [makeItem({ priority: 'High' }), makeItem({ priority: 'Critical' })];
    sortByPriority(docs);
    assert.equal(docs[0].priority, 'Critical');
  });

  test('High sorts before Medium', () => {
    const docs = [makeItem({ priority: 'Medium' }), makeItem({ priority: 'High' })];
    sortByPriority(docs);
    assert.equal(docs[0].priority, 'High');
  });

  test('Medium sorts before Low', () => {
    const docs = [makeItem({ priority: 'Low' }), makeItem({ priority: 'Medium' })];
    sortByPriority(docs);
    assert.equal(docs[0].priority, 'Medium');
  });

  test('unknown priority treated as Medium', () => {
    const docs = [makeItem({ priority: 'Unknown' }), makeItem({ priority: 'High' })];
    sortByPriority(docs);
    assert.equal(docs[0].priority, 'High');
  });
});

describe('sortByPriority — story points tiebreak (same rank + priority)', () => {
  test('higher story points come first', () => {
    const docs = [makeItem({ storyPoints: 3 }), makeItem({ storyPoints: 8 })];
    sortByPriority(docs);
    assert.equal(docs[0].storyPoints, 8);
    assert.equal(docs[1].storyPoints, 3);
  });
});

describe('sortByPriority — edge cases', () => {
  test('empty array does not throw', () => {
    assert.doesNotThrow(() => sortByPriority([]));
  });

  test('single item array stays unchanged', () => {
    const docs = [makeItem({ rank: 5 })];
    sortByPriority(docs);
    assert.equal(docs[0].rank, 5);
  });
});
