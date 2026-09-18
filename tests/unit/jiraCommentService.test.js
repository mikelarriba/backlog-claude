// ── Unit tests: src/services/jiraCommentService.js ────────────────────────────
// flattenAndFilterComments() is the pure logic behind GET /api/jira/comments:
// flatten comments across issues, filter each by its own created date and (when
// requested) whether it @-mentions the current user, newest-first.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { flattenAndFilterComments } from '../../src/services/jiraCommentService.js';

function issue(key, summary, comments) {
  return { key, fields: { summary, comment: { comments } } };
}

describe('flattenAndFilterComments', () => {
  test('flattens comments across issues into one list', () => {
    const issues = [
      issue('MID-1', 'First', [{ id: '1', created: '2026-09-10T10:00:00.000+0000', body: 'a' }]),
      issue('MID-2', 'Second', [{ id: '2', created: '2026-09-11T10:00:00.000+0000', body: 'b' }]),
    ];
    const out = flattenAndFilterComments(issues);
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((c) => c.issueKey),
      ['MID-2', 'MID-1']
    );
  });

  test('excludes comments outside the [from, to] date window', () => {
    // Issue is "recently updated" but carries an old comment — the old comment
    // must be excluded by its own created date, not the issue's updated date.
    const issues = [
      issue('MID-1', 'x', [
        { id: 'old', created: '2026-08-01T09:00:00.000+0000', body: 'old' },
        { id: 'in', created: '2026-09-10T09:00:00.000+0000', body: 'in-range' },
        { id: 'late', created: '2026-09-20T09:00:00.000+0000', body: 'too-late' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { from: '2026-09-05', to: '2026-09-15' });
    assert.deepEqual(
      out.map((c) => c.commentId),
      ['in']
    );
  });

  test('includes boundary dates (inclusive from and to)', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'f', created: '2026-09-05T00:00:00.000+0000', body: 'from-edge' },
        { id: 't', created: '2026-09-15T23:59:00.000+0000', body: 'to-edge' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { from: '2026-09-05', to: '2026-09-15' });
    assert.equal(out.length, 2);
  });

  test('detects [~username] mentions case-insensitively on the raw body', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'm', created: '2026-09-10T09:00:00.000+0000', body: 'hey [~JDoe] please review' },
        { id: 'n', created: '2026-09-10T09:00:00.000+0000', body: 'no mention here' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { myName: 'jdoe' });
    const byId = Object.fromEntries(out.map((c) => [c.commentId, c.mentionsMe]));
    assert.equal(byId['m'], true);
    assert.equal(byId['n'], false);
  });

  test("does not flag a different user's mention", () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'm', created: '2026-09-10T09:00:00.000+0000', body: 'ping [~someoneelse]' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { myName: 'jdoe' });
    assert.equal(out[0].mentionsMe, false);
  });

  test('mentionedOnly keeps only comments that mention the current user', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'm', created: '2026-09-10T09:00:00.000+0000', body: '[~jdoe] hi' },
        { id: 'n', created: '2026-09-10T09:00:00.000+0000', body: 'unrelated' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { myName: 'jdoe', mentionedOnly: true });
    assert.deepEqual(
      out.map((c) => c.commentId),
      ['m']
    );
  });

  test('notRepliedByMe excludes the whole issue when the latest comment is mine', () => {
    // Reproduces EAMDM-11054: others commented earlier, but my reply is last —
    // the issue must not appear at all, even though others authored comments.
    const issues = [
      issue('MID-1', 'x', [
        { id: 'a', created: '2026-09-15T09:00:00.000+0000', body: 'hi', author: { name: 'bob' } },
        { id: 'b', created: '2026-09-15T10:00:00.000+0000', body: 'q', author: { name: 'jdoe' } },
        {
          id: 'c',
          created: '2026-09-15T11:00:00.000+0000',
          body: 'ans',
          author: { name: 'alice' },
        },
        {
          id: 'd',
          created: '2026-09-16T09:00:00.000+0000',
          body: 'thanks',
          author: { name: 'jdoe' },
        },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { myName: 'jdoe', notRepliedByMe: true });
    assert.equal(out.length, 0);
  });

  test('notRepliedByMe keeps an issue whose latest comment is someone else, hiding my own', () => {
    const issues = [
      issue('MID-1', 'x', [
        {
          id: 'mine',
          created: '2026-09-15T09:00:00.000+0000',
          body: 'a',
          author: { name: 'JDoe' },
        },
        {
          id: 'other',
          created: '2026-09-16T09:00:00.000+0000',
          body: 'b',
          author: { name: 'someoneelse' },
        },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { myName: 'jdoe', notRepliedByMe: true });
    // Issue kept (last comment is someone else's); my own earlier comment hidden.
    assert.deepEqual(
      out.map((c) => c.commentId),
      ['other']
    );
  });

  test('notRepliedByMe and mentionedOnly stack (AND)', () => {
    const issues = [
      issue('MID-1', 'x', [
        // mentions me AND authored by someone else → the ones I should reply to
        {
          id: 'toreply',
          created: '2026-09-10T09:00:00.000+0000',
          body: '[~jdoe] hi',
          author: { name: 'bob' },
        },
        // mentions me but I already replied (authored by me)
        {
          id: 'mine',
          created: '2026-09-10T09:00:00.000+0000',
          body: 'thanks [~jdoe]',
          author: { name: 'jdoe' },
        },
        // authored by someone else but no mention of me
        {
          id: 'noping',
          created: '2026-09-10T09:00:00.000+0000',
          body: 'unrelated',
          author: { name: 'bob' },
        },
      ]),
    ];
    const out = flattenAndFilterComments(issues, {
      myName: 'jdoe',
      notRepliedByMe: true,
      mentionedOnly: true,
    });
    assert.deepEqual(
      out.map((c) => c.commentId),
      ['toreply']
    );
  });

  test('notRepliedByMe with no myName excludes nothing', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'a', created: '2026-09-10T09:00:00.000+0000', body: 'x', author: { name: 'jdoe' } },
      ]),
    ];
    const out = flattenAndFilterComments(issues, { notRepliedByMe: true });
    assert.equal(out.length, 1);
  });

  test('sorts newest-first by created', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'a', created: '2026-09-01T09:00:00.000+0000', body: 'a' },
        { id: 'c', created: '2026-09-03T09:00:00.000+0000', body: 'c' },
        { id: 'b', created: '2026-09-02T09:00:00.000+0000', body: 'b' },
      ]),
    ];
    const out = flattenAndFilterComments(issues);
    assert.deepEqual(
      out.map((c) => c.commentId),
      ['c', 'b', 'a']
    );
  });

  test('applies transformBody to display body but detects mentions on raw', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'm', created: '2026-09-10T09:00:00.000+0000', body: '[~jdoe] see this' },
      ]),
    ];
    const out = flattenAndFilterComments(issues, {
      myName: 'jdoe',
      transformBody: (raw) => raw.replace(/\[~jdoe\]/i, '@Jane Doe'),
    });
    assert.equal(out[0].mentionsMe, true);
    assert.equal(out[0].body, '@Jane Doe see this');
  });

  test('falls back to username, then Unknown, for author display', () => {
    const issues = [
      issue('MID-1', 'x', [
        { id: 'a', created: '2026-09-10T09:00:00.000+0000', body: 'x', author: { name: 'jdoe' } },
        { id: 'b', created: '2026-09-10T09:00:00.000+0000', body: 'y' },
      ]),
    ];
    const out = flattenAndFilterComments(issues);
    const byId = Object.fromEntries(out.map((c) => [c.commentId, c.author]));
    assert.equal(byId['a'], 'jdoe');
    assert.equal(byId['b'], 'Unknown');
  });
});
