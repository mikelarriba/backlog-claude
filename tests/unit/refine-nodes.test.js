// ── Unit tests: public/js/refine-nodes.js ────────────────────────────────────
// Pure logic extracted from DOM-heavy flows (#460), exercised without a DOM:
// buildParentLinkFields (request-body fields shared by the empty-cell
// "generate & link" flow and the split flow) and buildFpEpicMenuItemsHtml
// (the feature multi-panel's "Move to Epic" submenu markup). refine-nodes.js
// is part of the same refine.js <-> list.js <-> detail.js circular import
// chain documented in dragdrop.test.js, so detail.js and list.js are
// mocked out before the dynamic import below; neither function under test
// calls into them.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/detail.js', {
  namedExports: { closeDeleteDialog: () => {}, executeDelete: async () => {}, openDoc: () => {} },
});
mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {}, contextSplitItem: () => {} },
});

const { buildParentLinkFields, buildFpEpicMenuItemsHtml } =
  await import('../../public/js/refine-nodes.js');

// ── buildParentLinkFields ─────────────────────────────────────────────────────
describe('buildParentLinkFields()', () => {
  test('inherits fixVersion and pi from the parent doc', () => {
    const parentDoc = { fixVersion: 'PI-2026.1', pi: 'PI-2026.1' };
    assert.deepEqual(buildParentLinkFields(parentDoc, 'epic', 'epic1.md'), {
      fixVersion: 'PI-2026.1',
      pi: 'PI-2026.1',
      parentEpic: 'epic1.md',
    });
  });

  test('omits pi when the parent doc\'s pi is the "TBD" placeholder', () => {
    const parentDoc = { fixVersion: 'PI-2026.1', pi: 'TBD' };
    const fields = buildParentLinkFields(parentDoc, 'epic', 'epic1.md');
    assert.equal('pi' in fields, false);
    assert.equal(fields.fixVersion, 'PI-2026.1');
  });

  test('omits fixVersion/pi entirely when the parent doc has neither set', () => {
    const parentDoc = { fixVersion: null, pi: null };
    const fields = buildParentLinkFields(parentDoc, 'epic', 'epic1.md');
    assert.equal('fixVersion' in fields, false);
    assert.equal('pi' in fields, false);
  });

  test('an undefined parent doc still resolves the parent* field from epicDocType', () => {
    assert.deepEqual(buildParentLinkFields(undefined, 'feature', 'feat1.md'), {
      parentFeature: 'feat1.md',
    });
  });

  test('epicDocType "epic" sets parentEpic, not parentFeature', () => {
    const fields = buildParentLinkFields(undefined, 'epic', 'epic1.md');
    assert.deepEqual(fields, { parentEpic: 'epic1.md' });
  });

  test('epicDocType "feature" sets parentFeature, not parentEpic', () => {
    const fields = buildParentLinkFields(undefined, 'feature', 'feat1.md');
    assert.deepEqual(fields, { parentFeature: 'feat1.md' });
  });

  test('an epicDocType that is neither "epic" nor "feature" sets neither parent field', () => {
    const fields = buildParentLinkFields(undefined, 'story', 'story1.md');
    assert.deepEqual(fields, {});
  });
});

// ── buildFpEpicMenuItemsHtml ──────────────────────────────────────────────────
describe('buildFpEpicMenuItemsHtml()', () => {
  test('returns an empty string when there are no open-panel epics', () => {
    assert.equal(buildFpEpicMenuItemsHtml([], 'epic1.md', []), '');
  });

  test('labels an epic from its matching doc and leaves it enabled/unmarked when not current', () => {
    const docs = [{ filename: 'epic1.md', docType: 'epic', title: 'Checkout revamp' }];
    const html = buildFpEpicMenuItemsHtml(['epic1.md'], 'epic2.md', docs);
    assert.match(html, /class="fp-ctx-epic-btn"/);
    assert.doesNotMatch(html, /disabled/);
    assert.match(html, /data-epic="epic1\.md"/);
    assert.match(html, />\s*Checkout revamp\s*<\/button>/);
  });

  test('marks the current epic disabled, with the current class and "(current)" suffix', () => {
    const docs = [{ filename: 'epic1.md', docType: 'epic', title: 'Checkout revamp' }];
    const html = buildFpEpicMenuItemsHtml(['epic1.md'], 'epic1.md', docs);
    assert.match(html, /class="fp-ctx-epic-btn fp-ctx-epic-current"/);
    assert.match(html, /disabled/);
    assert.match(html, /Checkout revamp \(current\)/);
  });

  test('falls back to the raw filename when no matching epic doc is found', () => {
    const html = buildFpEpicMenuItemsHtml(['epic1.md'], 'epic2.md', []);
    assert.match(html, />\s*epic1\.md\s*</);
  });

  test('ignores a doc with the same filename but a non-epic docType (falls back to filename)', () => {
    const docs = [{ filename: 'epic1.md', docType: 'feature', title: 'Wrong type' }];
    const html = buildFpEpicMenuItemsHtml(['epic1.md'], 'epic2.md', docs);
    assert.match(html, />\s*epic1\.md\s*</);
    assert.doesNotMatch(html, /Wrong type/);
  });

  test('renders multiple epics in order, joined with no separator', () => {
    const docs = [
      { filename: 'epic1.md', docType: 'epic', title: 'First' },
      { filename: 'epic2.md', docType: 'epic', title: 'Second' },
    ];
    const html = buildFpEpicMenuItemsHtml(['epic1.md', 'epic2.md'], 'epic1.md', docs);
    assert.ok(html.indexOf('First') < html.indexOf('Second'));
    assert.equal((html.match(/<button/g) || []).length, 2);
  });

  test('HTML-escapes the label and the data-epic filename', () => {
    const docs = [{ filename: '<e>.md', docType: 'epic', title: 'A & B <script>' }];
    const html = buildFpEpicMenuItemsHtml(['<e>.md'], 'epic2.md', docs);
    assert.match(html, /data-epic="&lt;e&gt;\.md"/);
    assert.match(html, /A &amp; B &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  });
});
