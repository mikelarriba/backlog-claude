// ── Unit tests: groupByEpic ───────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupByEpic } from '../../src/services/distributionService.js';

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

describe('groupByEpic — basic grouping', () => {
  test('docs without parentFilename become standalones', () => {
    const docs = [makeDoc({ filename: 'a.md' }), makeDoc({ filename: 'b.md' })];
    const { sortedGroups, standalones } = groupByEpic(docs, new Map());
    assert.equal(sortedGroups.length, 0);
    assert.equal(standalones.length, 2);
  });

  test('docs with parentFilename are grouped', () => {
    const docs = [
      makeDoc({ filename: 'a.md', parentFilename: 'epic1.md' }),
      makeDoc({ filename: 'b.md', parentFilename: 'epic1.md' }),
    ];
    const { sortedGroups, standalones } = groupByEpic(docs, new Map());
    assert.equal(sortedGroups.length, 1);
    assert.equal(sortedGroups[0].length, 2);
    assert.equal(standalones.length, 0);
  });

  test('multiple epics produce multiple groups', () => {
    const docs = [
      makeDoc({ filename: 'a.md', parentFilename: 'epic1.md' }),
      makeDoc({ filename: 'b.md', parentFilename: 'epic2.md' }),
    ];
    const { sortedGroups } = groupByEpic(docs, new Map());
    assert.equal(sortedGroups.length, 2);
  });
});

describe('groupByEpic — epic rank ordering', () => {
  test('lower epic rank group comes first', () => {
    const docs = [
      makeDoc({ filename: 'a.md', parentFilename: 'epic2.md' }),
      makeDoc({ filename: 'b.md', parentFilename: 'epic1.md' }),
    ];
    const epicRankMap = new Map([
      ['epic1.md', 1],
      ['epic2.md', 2],
    ]);
    const { sortedGroups } = groupByEpic(docs, epicRankMap);
    assert.equal(sortedGroups[0][0].filename, 'b.md');
    assert.equal(sortedGroups[1][0].filename, 'a.md');
  });

  test('epics not in rank map get rank 9999 (go last)', () => {
    const docs = [
      makeDoc({ filename: 'a.md', parentFilename: 'unknown-epic.md' }),
      makeDoc({ filename: 'b.md', parentFilename: 'known-epic.md' }),
    ];
    const epicRankMap = new Map([['known-epic.md', 1]]);
    const { sortedGroups } = groupByEpic(docs, epicRankMap);
    assert.equal(sortedGroups[0][0].filename, 'b.md');
    assert.equal(sortedGroups[1][0].filename, 'a.md');
  });
});

describe('groupByEpic — empty input', () => {
  test('returns empty groups and standalones for empty input', () => {
    const { sortedGroups, standalones } = groupByEpic([], new Map());
    assert.equal(sortedGroups.length, 0);
    assert.equal(standalones.length, 0);
  });
});
