// ── Benchmark: distributionService greedy algorithm ────────────────────────────
// Verifies that proposeDistribution scales acceptably for large backlogs.
// Run via: npm run test:bench
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { proposeDistribution } from '../../src/services/distributionService.js';

const THRESHOLD_MS = 500; // 500ms — generous bound for 200+ stories

function makeStory(overrides = {}) {
  return {
    filename: `story-${Math.random().toString(36).slice(2)}.md`,
    docType: 'story',
    title: 'A Story',
    storyPoints: Math.floor(Math.random() * 5) + 1,
    hasEstimate: true,
    priority: 'Medium',
    sprint: null,
    rank: Math.floor(Math.random() * 1000),
    parentFilename: null,
    blockedBy: [],
    blocks: [],
    parallel: [],
    ...overrides,
  };
}

function makeSprints(count, capacity = 30) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Sprint ${i + 1}`,
    capacity,
  }));
}

describe('distributionService benchmark', () => {
  test(`proposeDistribution with 200 stories and 10 sprints completes in under ${THRESHOLD_MS}ms`, () => {
    const stories = Array.from({ length: 200 }, () => makeStory());
    const sprints = makeSprints(10);

    const start = performance.now();
    const result = proposeDistribution(stories, sprints, new Map());
    const elapsed = performance.now() - start;

    assert.ok(elapsed < THRESHOLD_MS,
      `proposeDistribution took ${elapsed.toFixed(1)}ms — expected < ${THRESHOLD_MS}ms`);
    assert.ok(result.sprints.length === 10, 'should return all sprints');
    console.log(`  200 stories × 10 sprints: ${elapsed.toFixed(1)}ms`);
  });

  test('proposeDistribution with 500 stories and 20 sprints completes in under 2000ms', () => {
    const stories = Array.from({ length: 500 }, () => makeStory());
    const sprints = makeSprints(20, 50);

    const start = performance.now();
    proposeDistribution(stories, sprints, new Map());
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 2000,
      `proposeDistribution took ${elapsed.toFixed(1)}ms — expected < 2000ms`);
    console.log(`  500 stories × 20 sprints: ${elapsed.toFixed(1)}ms`);
  });

  test('proposeDistribution with dependency chains completes acceptably', () => {
    // Build a chain: story[i] blocks story[i+1]
    const stories = Array.from({ length: 100 }, (_, i) =>
      makeStory({
        filename: `chain-${i}.md`,
        rank: i,
        blocks: i < 99 ? [`chain-${i + 1}.md`] : [],
        blockedBy: i > 0 ? [`chain-${i - 1}.md`] : [],
      })
    );
    const sprints = makeSprints(15, 20);

    const start = performance.now();
    proposeDistribution(stories, sprints, new Map());
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 1000,
      `Dependency chain distribution took ${elapsed.toFixed(1)}ms — expected < 1000ms`);
    console.log(`  100 chained stories × 15 sprints: ${elapsed.toFixed(1)}ms`);
  });

  test('all sprint capacities are respected (no sprint exceeds capacity)', () => {
    const stories = Array.from({ length: 100 }, () =>
      makeStory({ storyPoints: 3 })
    );
    const sprints = makeSprints(5, 20);

    const result = proposeDistribution(stories, sprints, new Map());

    for (const sprint of result.sprints) {
      const total = sprint.assigned.reduce((sum, d) => sum + (d.storyPoints || 0), 0);
      assert.ok(total <= 20,
        `Sprint "${sprint.name}" has ${total} points but capacity is 20`);
    }
  });
});
