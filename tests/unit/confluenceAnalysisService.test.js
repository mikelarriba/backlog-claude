// ── Unit tests: parseConfluenceSuggestions (src/services/confluenceAnalysisService.ts) ─
// Covers the JSON-from-AI parsing/validation helper in isolation — no server,
// no JIRA, no Claude. Full request/response behavior (400/503/500/200) is
// covered by tests/integration/confluence.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfluenceSuggestions,
  resolveSuggestionLink,
  buildConfluencePageUrl,
} from '../../src/services/confluenceAnalysisService.ts';

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

// ── Unit tests: resolveSuggestionLink / buildConfluencePageUrl (#662) ─────────
describe('buildConfluencePageUrl', () => {
  test('builds a pageId-keyed viewpage.action permalink', () => {
    assert.equal(
      buildConfluencePageUrl('https://example.atlassian.net', '12345'),
      'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=12345'
    );
  });
});

describe('resolveSuggestionLink', () => {
  const pagesByTitle = new Map([
    ['MIDAS Upload API', { id: '111' }],
    ['API Reference', { id: '222' }],
  ]);
  const base = 'https://example.atlassian.net';

  test('Update: links to the existing page matching pageTitle', () => {
    const url = resolveSuggestionLink(
      { action: 'Update', pageTitle: 'MIDAS Upload API', hierarchyPath: '' },
      pagesByTitle,
      base
    );
    assert.equal(url, 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=111');
  });

  test('Delete: links to the existing page matching pageTitle', () => {
    const url = resolveSuggestionLink(
      { action: 'Delete', pageTitle: 'MIDAS Upload API', hierarchyPath: '' },
      pagesByTitle,
      base
    );
    assert.equal(url, 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=111');
  });

  test('Create: links to the parent page (last segment of hierarchyPath)', () => {
    const url = resolveSuggestionLink(
      { action: 'Create', pageTitle: 'New Page', hierarchyPath: 'MIDAS > API Reference' },
      pagesByTitle,
      base
    );
    assert.equal(url, 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=222');
  });

  test('returns null when the target/parent page cannot be found', () => {
    assert.equal(
      resolveSuggestionLink(
        { action: 'Update', pageTitle: 'Unknown Page', hierarchyPath: '' },
        pagesByTitle,
        base
      ),
      null
    );
    assert.equal(
      resolveSuggestionLink(
        { action: 'Create', pageTitle: 'New Page', hierarchyPath: 'Nonexistent Parent' },
        pagesByTitle,
        base
      ),
      null
    );
  });

  test('returns null when base is empty (Confluence not configured)', () => {
    assert.equal(
      resolveSuggestionLink(
        { action: 'Update', pageTitle: 'MIDAS Upload API', hierarchyPath: '' },
        pagesByTitle,
        ''
      ),
      null
    );
  });

  test('returns null for Create when hierarchyPath is empty', () => {
    assert.equal(
      resolveSuggestionLink(
        { action: 'Create', pageTitle: 'New Page', hierarchyPath: '' },
        pagesByTitle,
        base
      ),
      null
    );
  });
});
