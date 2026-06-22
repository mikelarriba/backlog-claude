// ── Unit tests: buildDependencyMap ───────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyMap } from '../../src/services/distributionService.js';

function makeDoc(filename, blockedBy = []) {
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
    blockedBy,
    blocks: [],
    parallel: [],
  };
}

describe('buildDependencyMap — basic', () => {
  test('returns empty map for docs with no dependencies', () => {
    const docs = [makeDoc('a.md'), makeDoc('b.md')];
    const map = buildDependencyMap(docs);
    assert.equal(map.size, 0);
  });

  test('maps each doc to its set of blockers', () => {
    const docs = [makeDoc('a.md'), makeDoc('b.md', ['a.md'])];
    const map = buildDependencyMap(docs);
    assert.equal(map.size, 1);
    assert.ok(map.has('b.md'));
    assert.ok(map.get('b.md').has('a.md'));
  });

  test('multiple blockers for one doc', () => {
    const docs = [makeDoc('c.md', ['a.md', 'b.md'])];
    const map = buildDependencyMap(docs);
    assert.equal(map.get('c.md').size, 2);
    assert.ok(map.get('c.md').has('a.md'));
    assert.ok(map.get('c.md').has('b.md'));
  });

  test('handles empty input', () => {
    const map = buildDependencyMap([]);
    assert.equal(map.size, 0);
  });

  test('docs without blockedBy are not in the map', () => {
    const docs = [makeDoc('a.md', ['x.md']), makeDoc('b.md')];
    const map = buildDependencyMap(docs);
    assert.ok(map.has('a.md'));
    assert.ok(!map.has('b.md'));
  });
});
