// ── Unit tests: public/js/roadmap-select.js ─────────────────────────────────
// computeShiftRangeSelection() is the pure range-computation helper
// extracted from handleRoadmapCardClick/handleRoadmapEpicClick's shift-click
// branches (#460) — previously duplicated verbatim in both. The module has
// no static imports of its own (openDoc/focusEpic are ambient globals, per
// global.d.ts), so it's importable directly with no mocking needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

const { computeShiftRangeSelection } = await import('../../public/js/roadmap-select.js');

function card(filename, docType = 'story') {
  return { filename, docType };
}

describe('computeShiftRangeSelection()', () => {
  const cards = [card('a.md'), card('b.md'), card('c.md'), card('d.md'), card('e.md')];

  test('returns the inclusive range when the last-clicked card precedes the current one', () => {
    const result = computeShiftRangeSelection(cards, 'b.md', 'd.md', 'story');
    assert.deepEqual(
      result.map((c) => c.filename),
      ['b.md', 'c.md', 'd.md']
    );
  });

  test('returns the inclusive range in DOM order when clicked in reverse (current precedes last)', () => {
    const result = computeShiftRangeSelection(cards, 'd.md', 'b.md', 'story');
    assert.deepEqual(
      result.map((c) => c.filename),
      ['b.md', 'c.md', 'd.md']
    );
  });

  test('returns just the single card when last-clicked and current are the same', () => {
    const result = computeShiftRangeSelection(cards, 'c.md', 'c.md', 'story');
    assert.deepEqual(
      result.map((c) => c.filename),
      ['c.md']
    );
  });

  test('falls back to just the current card when the last-clicked filename is no longer visible', () => {
    const result = computeShiftRangeSelection(cards, 'gone.md', 'c.md', 'story');
    assert.deepEqual(result, [{ filename: 'c.md', docType: 'story' }]);
  });

  test('returns nothing when the current card is not found among the visible cards either', () => {
    const result = computeShiftRangeSelection(cards, 'gone.md', 'also-gone.md', 'story');
    assert.deepEqual(result, []);
  });

  test('returns nothing for an empty card list', () => {
    assert.deepEqual(computeShiftRangeSelection([], 'a.md', 'b.md', 'story'), []);
  });

  test("preserves each card's own docType across the range, not just the clicked one's", () => {
    const mixed = [card('a.md', 'epic'), card('b.md', 'story'), card('c.md', 'epic')];
    const result = computeShiftRangeSelection(mixed, 'a.md', 'c.md', 'epic');
    assert.deepEqual(result, [
      { filename: 'a.md', docType: 'epic' },
      { filename: 'b.md', docType: 'story' },
      { filename: 'c.md', docType: 'epic' },
    ]);
  });
});
