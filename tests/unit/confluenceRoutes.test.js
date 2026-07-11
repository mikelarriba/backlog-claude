// ── Unit tests: parseConfluenceSuggestions (src/routes/confluence.ts) ─────────
// Covers the JSON-from-AI parsing/validation helper in isolation — no server,
// no JIRA, no Claude. Full request/response behavior (400/503/500/200) is
// covered by tests/integration/confluence.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfluenceSuggestions } from '../../src/routes/confluence.ts';

describe('parseConfluenceSuggestions', () => {
  test('parses a well-formed JSON array', () => {
    const raw = JSON.stringify([
      {
        pageTitle: 'MIDAS Upload API',
        hierarchyPath: 'MIDAS > API Reference > Upload',
        action: 'Update',
        currentContent: 'old content',
        proposedContent: 'new content',
      },
    ]);
    const result = parseConfluenceSuggestions(raw);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      pageTitle: 'MIDAS Upload API',
      hierarchyPath: 'MIDAS > API Reference > Upload',
      action: 'Update',
      currentContent: 'old content',
      proposedContent: 'new content',
    });
  });

  test('strips a ```json ... ``` markdown code fence before parsing', () => {
    const raw = '```json\n[{"pageTitle":"Page A","action":"Create"}]\n```';
    const result = parseConfluenceSuggestions(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].pageTitle, 'Page A');
    assert.equal(result[0].action, 'Create');
  });

  test('defaults missing optional fields (hierarchyPath, currentContent, proposedContent) to empty strings', () => {
    const raw = JSON.stringify([{ pageTitle: 'Page A', action: 'Create' }]);
    const result = parseConfluenceSuggestions(raw);
    assert.equal(result[0].hierarchyPath, '');
    assert.equal(result[0].currentContent, '');
    assert.equal(result[0].proposedContent, '');
  });

  test('returns an empty array when Claude reports no changes needed', () => {
    assert.deepEqual(parseConfluenceSuggestions('[]'), []);
  });

  test('throws on invalid JSON', () => {
    assert.throws(() => parseConfluenceSuggestions('not json at all'), /not valid JSON/);
  });

  test('throws when the top-level value is not an array', () => {
    assert.throws(
      () => parseConfluenceSuggestions(JSON.stringify({ pageTitle: 'Page A' })),
      /not a JSON array/
    );
  });

  test('throws when a suggestion is missing pageTitle', () => {
    const raw = JSON.stringify([{ action: 'Create' }]);
    assert.throws(() => parseConfluenceSuggestions(raw), /missing required fields/);
  });

  test('throws when a suggestion has an invalid action', () => {
    const raw = JSON.stringify([{ pageTitle: 'Page A', action: 'Archive' }]);
    assert.throws(() => parseConfluenceSuggestions(raw), /missing required fields|invalid action/);
  });
});
