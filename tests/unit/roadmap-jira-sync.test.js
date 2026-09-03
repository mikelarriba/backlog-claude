// ── Unit tests: public/js/roadmap-jira-sync.js ──────────────────────────────
// Pure SSE-buffer parsing, sprint-change filtering/formatting, and
// result-summary helpers extracted from the roadmap sprint push/pull flows
// (#460), exercised without a DOM. roadmap-jira-sync.js statically imports
// list.js (which pulls in detail.js -> main.js and its top-level DOM
// listeners), so list.js is mocked out before the dynamic import below; the
// functions under test never call into it.
import { mock, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/domGlobals.js';

mock.module('../../public/js/list.js', {
  namedExports: { loadDocs: async () => {} },
});

const {
  splitSSEBuffer,
  extractSSEDataPayload,
  filterSprintPushChanges,
  countSprintPushChangesByType,
  formatSprintChangeArrow,
  sprintChangeBadgeLabel,
  buildSprintPushRowHtml,
  JIRA_TYPE_TO_LOCAL,
  summarizeSprintPushResult,
  formatSprintPushConfirmLabel,
  buildPullSprintResultItemHtml,
  summarizePullSprintResult,
  formatPullSprintConfirmLabel,
  ROADMAP_JIRA_SYNC_CHANGE_ACTIONS,
} = await import('../../public/js/roadmap-jira-sync.js');

// ── splitSSEBuffer ────────────────────────────────────────────────────────────
describe('splitSSEBuffer()', () => {
  test('a buffer with no trailing newline: everything is the remainder, no lines', () => {
    const { lines, remainder } = splitSSEBuffer('data: {"a":1}');
    assert.deepEqual(lines, []);
    assert.equal(remainder, 'data: {"a":1}');
  });

  test('complete lines are returned, partial trailing text becomes the remainder', () => {
    const { lines, remainder } = splitSSEBuffer('data: one\ndata: two\ndata: partia');
    assert.deepEqual(lines, ['data: one', 'data: two']);
    assert.equal(remainder, 'data: partia');
  });

  test('a buffer ending exactly on a newline leaves an empty remainder', () => {
    const { lines, remainder } = splitSSEBuffer('data: one\n');
    assert.deepEqual(lines, ['data: one']);
    assert.equal(remainder, '');
  });

  test('empty buffer produces no lines and an empty remainder', () => {
    const { lines, remainder } = splitSSEBuffer('');
    assert.deepEqual(lines, []);
    assert.equal(remainder, '');
  });
});

// ── extractSSEDataPayload ─────────────────────────────────────────────────────
describe('extractSSEDataPayload()', () => {
  test('strips the "data: " prefix', () => {
    assert.equal(extractSSEDataPayload('data: {"type":"progress"}'), '{"type":"progress"}');
  });

  test('non-data lines (blank keep-alives, comments) return null', () => {
    assert.equal(extractSSEDataPayload(''), null);
    assert.equal(extractSSEDataPayload(': keep-alive'), null);
    assert.equal(extractSSEDataPayload('event: foo'), null);
  });
});

// ── filterSprintPushChanges ───────────────────────────────────────────────────
describe('filterSprintPushChanges()', () => {
  test('keeps add/change/pull change types', () => {
    const changes = [{ changeType: 'add' }, { changeType: 'pull' }];
    assert.equal(filterSprintPushChanges(changes).length, 2);
  });

  test('drops an unrecognized change type', () => {
    const changes = [{ changeType: 'noop' }];
    assert.deepEqual(filterSprintPushChanges(changes), []);
  });

  test('drops a "change" whose target sprint equals the current sprint (case/space insensitive)', () => {
    const changes = [
      { changeType: 'change', targetSprint: ' Sprint 1 ', currentJiraSprint: 'sprint 1' },
    ];
    assert.deepEqual(filterSprintPushChanges(changes), []);
  });

  test('keeps a "change" whose target sprint genuinely differs', () => {
    const changes = [
      { changeType: 'change', targetSprint: 'Sprint 2', currentJiraSprint: 'Sprint 1' },
    ];
    assert.equal(filterSprintPushChanges(changes).length, 1);
  });

  test('a "change" missing targetSprint or currentJiraSprint is kept (falls through to the type check)', () => {
    const changes = [{ changeType: 'change', targetSprint: 'Sprint 1' }];
    assert.equal(filterSprintPushChanges(changes).length, 1);
  });
});

// ── countSprintPushChangesByType ──────────────────────────────────────────────
describe('countSprintPushChangesByType()', () => {
  test('counts each change type independently', () => {
    const changes = [
      { changeType: 'add' },
      { changeType: 'add' },
      { changeType: 'change' },
      { changeType: 'pull' },
    ];
    assert.deepEqual(countSprintPushChangesByType(changes), {
      adds: 2,
      changesCount: 1,
      pulls: 1,
    });
  });

  test('empty list counts all zero', () => {
    assert.deepEqual(countSprintPushChangesByType([]), { adds: 0, changesCount: 0, pulls: 0 });
  });
});

// ── formatSprintChangeArrow / sprintChangeBadgeLabel ──────────────────────────
describe('formatSprintChangeArrow()', () => {
  test('"add" shows an em-dash origin', () => {
    assert.equal(
      formatSprintChangeArrow({ changeType: 'add', targetSprint: 'Sprint 3' }),
      '— → Sprint 3'
    );
  });

  test('"change" shows current -> target', () => {
    assert.equal(
      formatSprintChangeArrow({
        changeType: 'change',
        currentJiraSprint: 'S1',
        targetSprint: 'S2',
      }),
      'S1 → S2'
    );
  });

  test('"pull" shows JIRA -> local', () => {
    assert.equal(
      formatSprintChangeArrow({ changeType: 'pull', currentJiraSprint: 'S1' }),
      'JIRA: S1 → local'
    );
  });

  test('an unknown change type produces an empty string', () => {
    assert.equal(formatSprintChangeArrow({ changeType: 'other' }), '');
  });
});

describe('sprintChangeBadgeLabel()', () => {
  test('"add" reads as "push"', () => {
    assert.equal(sprintChangeBadgeLabel({ changeType: 'add' }), 'push');
  });

  test('"pull" reads as "pull"', () => {
    assert.equal(sprintChangeBadgeLabel({ changeType: 'pull' }), 'pull');
  });

  test('any other type passes through unchanged', () => {
    assert.equal(sprintChangeBadgeLabel({ changeType: 'change' }), 'change');
  });
});

// ── buildSprintPushRowHtml ────────────────────────────────────────────────────
describe('buildSprintPushRowHtml()', () => {
  function change(extra = {}) {
    return {
      changeType: 'add',
      jiraId: 'PROJ-1',
      title: 'Do the thing',
      filename: 'do-the-thing.md',
      docType: 'story',
      targetSprint: 'Sprint 3',
      ...extra,
    };
  }

  test('renders the title, key, arrow, and change-type badge', () => {
    const html = buildSprintPushRowHtml(change());
    assert.match(html, /sprint-push-item-title" title="Do the thing">Do the thing</);
    assert.match(html, /sprint-push-item-key">PROJ-1</);
    assert.match(html, /sprint-push-item-arrow">— → Sprint 3</);
    assert.match(html, /sprint-push-badge sprint-push-badge-add">push</);
  });

  test('wires up the checkbox data-* attributes from the change', () => {
    const html = buildSprintPushRowHtml(change());
    assert.match(
      html,
      /data-jira-id="PROJ-1" data-change-type="add"[\s\S]*data-filename="do-the-thing\.md" data-target-sprint="Sprint 3"[\s\S]*data-doc-type="story"/
    );
    assert.match(
      html,
      new RegExp(`data-change-action="${ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.sprintPushUpdateCount}"`)
    );
  });

  test('missing filename, targetSprint, and docType fall back to empty attribute values', () => {
    const html = buildSprintPushRowHtml(
      change({ filename: undefined, targetSprint: undefined, docType: undefined })
    );
    assert.match(html, /data-filename="" data-target-sprint=""/);
    assert.match(html, /data-doc-type=""/);
  });

  test('a "change" type renders the current -> target arrow and "change" badge', () => {
    const html = buildSprintPushRowHtml(
      change({ changeType: 'change', currentJiraSprint: 'Sprint 1', targetSprint: 'Sprint 2' })
    );
    assert.match(html, /sprint-push-item-arrow">Sprint 1 → Sprint 2</);
    assert.match(html, /sprint-push-badge sprint-push-badge-change">change</);
  });

  test('a "pull" type renders the JIRA -> local arrow and "pull" badge', () => {
    const html = buildSprintPushRowHtml(
      change({ changeType: 'pull', currentJiraSprint: 'Sprint 1' })
    );
    assert.match(html, /sprint-push-item-arrow">JIRA: Sprint 1 → local</);
    assert.match(html, /sprint-push-badge sprint-push-badge-pull">pull</);
  });

  test('escapes HTML-significant characters in the title and jiraId', () => {
    const html = buildSprintPushRowHtml(
      change({ title: '<script>alert("x")</script> & "quoted"', jiraId: 'PROJ-<1>' })
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(
      html,
      /title="&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;quoted&quot;"/
    );
    assert.match(html, /sprint-push-item-key">PROJ-&lt;1&gt;</);
  });
});

// ── JIRA_TYPE_TO_LOCAL ────────────────────────────────────────────────────────
describe('JIRA_TYPE_TO_LOCAL', () => {
  test('maps known JIRA issue types to local doc types', () => {
    assert.equal(JIRA_TYPE_TO_LOCAL['New Feature'], 'feature');
    assert.equal(JIRA_TYPE_TO_LOCAL['Epic'], 'epic');
    assert.equal(JIRA_TYPE_TO_LOCAL['Story'], 'story');
    assert.equal(JIRA_TYPE_TO_LOCAL['Improvement'], 'story');
    assert.equal(JIRA_TYPE_TO_LOCAL['Task'], 'spike');
    assert.equal(JIRA_TYPE_TO_LOCAL['Bug'], 'bug');
  });

  test('an unmapped type is absent (callers fall back to "story")', () => {
    assert.equal(JIRA_TYPE_TO_LOCAL['Something Else'], undefined);
  });
});

// ── summarizeSprintPushResult ─────────────────────────────────────────────────
describe('summarizeSprintPushResult()', () => {
  test('reports ok/pushed/pulled/skipped/failed counts', () => {
    const items = [{ changeType: 'add' }, { changeType: 'change' }, { changeType: 'pull' }];
    const results = [
      { status: 'ok' },
      { status: 'ok' },
      { status: 'skipped' },
      { status: 'error' },
    ];
    const { msg, pulled, errors } = summarizeSprintPushResult(items, results);
    assert.equal(msg, 'Sprint sync: 2 updated (2 pushed) (1 pulled), 1 skipped, 1 failed');
    assert.equal(pulled, 1);
    assert.equal(errors, 1);
  });

  test('omits zero segments beyond the always-present "updated" count', () => {
    const items = [{ changeType: 'add' }];
    const results = [{ status: 'ok' }];
    const { msg } = summarizeSprintPushResult(items, results);
    assert.equal(msg, 'Sprint sync: 1 updated (1 pushed)');
  });

  test('no items, no results: just the zero "updated" baseline', () => {
    const { msg, pulled, errors } = summarizeSprintPushResult([], []);
    assert.equal(msg, 'Sprint sync: 0 updated');
    assert.equal(pulled, 0);
    assert.equal(errors, 0);
  });
});

// ── formatSprintPushConfirmLabel ──────────────────────────────────────────────
describe('formatSprintPushConfirmLabel()', () => {
  test('reports the checked/total counts in the label', () => {
    assert.deepEqual(formatSprintPushConfirmLabel(2, 5), {
      text: 'Sync Changes (2/5)',
      disabled: false,
    });
  });

  test('is disabled when nothing is checked', () => {
    assert.deepEqual(formatSprintPushConfirmLabel(0, 5), {
      text: 'Sync Changes (0/5)',
      disabled: true,
    });
  });

  test('is enabled once at least one item is checked, even if not all', () => {
    assert.equal(formatSprintPushConfirmLabel(1, 1).disabled, false);
  });
});

// ── buildPullSprintResultItemHtml ─────────────────────────────────────────────
describe('buildPullSprintResultItemHtml()', () => {
  function result(extra = {}) {
    return {
      key: 'PROJ-1',
      issuetype: 'Story',
      summary: 'Do the thing',
      sprintName: 'Sprint 3',
      ...extra,
    };
  }

  test('renders the type badge, key, summary, and sprint meta', () => {
    const html = buildPullSprintResultItemHtml(result());
    assert.match(html, /sprint-push-type sprint-push-type-story">Story</);
    assert.match(html, /<strong>PROJ-1<\/strong> Do the thing/);
    assert.match(html, /sprint-push-item-meta">Sprint 3 </);
  });

  test('maps the JIRA issue type to its local type for the badge CSS class', () => {
    const html = buildPullSprintResultItemHtml(result({ issuetype: 'Bug' }));
    assert.match(html, /sprint-push-type-bug">Bug</);
  });

  test('an unmapped issue type falls back to "story" for the badge CSS class', () => {
    const html = buildPullSprintResultItemHtml(result({ issuetype: 'Something Else' }));
    assert.match(html, /sprint-push-type-story">Something Else</);
  });

  test('wires up the checkbox value and data-sprint attribute', () => {
    const html = buildPullSprintResultItemHtml(result());
    assert.match(html, /value="PROJ-1" data-sprint="Sprint 3"/);
    assert.match(
      html,
      new RegExp(`data-change-action="${ROADMAP_JIRA_SYNC_CHANGE_ACTIONS.pullSprintUpdateCount}"`)
    );
  });

  test('with story points: appends "N SP" to the meta line', () => {
    const html = buildPullSprintResultItemHtml(result({ storyPoints: 5 }));
    assert.match(html, /sprint-push-item-meta">Sprint 3 · 5 SP</);
  });

  test('without story points (undefined or zero): no "SP" suffix in the meta line', () => {
    const htmlUndefined = buildPullSprintResultItemHtml(result());
    assert.match(htmlUndefined, /sprint-push-item-meta">Sprint 3 <\/div>/);

    const htmlZero = buildPullSprintResultItemHtml(result({ storyPoints: 0 }));
    assert.match(htmlZero, /sprint-push-item-meta">Sprint 3 <\/div>/);
  });

  test('a null story points value: no "SP" suffix in the meta line', () => {
    const html = buildPullSprintResultItemHtml(result({ storyPoints: null }));
    assert.match(html, /sprint-push-item-meta">Sprint 3 <\/div>/);
  });

  test('escapes HTML-significant characters in key, summary, and sprint name', () => {
    const html = buildPullSprintResultItemHtml(
      result({
        key: 'PROJ-<1>',
        summary: '<script>alert("x")</script> & "quoted"',
        sprintName: '<Sprint> & "co"',
      })
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<strong>PROJ-&lt;1&gt;<\/strong>/);
    assert.match(
      html,
      /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;quoted&quot;/
    );
    assert.match(html, /sprint-push-item-meta">&lt;Sprint&gt; &amp; &quot;co&quot; /);
  });

  test('escapes HTML-significant characters in the issue type used in both the CSS class and label', () => {
    const html = buildPullSprintResultItemHtml(result({ issuetype: '<Epic>' }));
    assert.match(html, /sprint-push-type-story">&lt;Epic&gt;</);
  });
});

// ── summarizePullSprintResult ─────────────────────────────────────────────────
describe('summarizePullSprintResult()', () => {
  test('singular "issue" for exactly one ok result', () => {
    assert.equal(summarizePullSprintResult([{ status: 'ok' }]), 'Pulled 1 issue');
  });

  test('plural "issues" for any other ok count', () => {
    assert.equal(summarizePullSprintResult([]), 'Pulled 0 issues');
    assert.equal(
      summarizePullSprintResult([{ status: 'ok' }, { status: 'ok' }]),
      'Pulled 2 issues'
    );
  });

  test('appends the failed count when errors occurred', () => {
    const results = [{ status: 'ok' }, { status: 'error' }, { status: 'error' }];
    assert.equal(summarizePullSprintResult(results), 'Pulled 1 issue, 2 failed');
  });
});

// ── formatPullSprintConfirmLabel ──────────────────────────────────────────────
describe('formatPullSprintConfirmLabel()', () => {
  test('reports the checked/total counts in the label', () => {
    assert.equal(formatPullSprintConfirmLabel(3, 7), 'Pull Selected (3/7)');
  });

  test('zero checked and zero total are both rendered plainly', () => {
    assert.equal(formatPullSprintConfirmLabel(0, 0), 'Pull Selected (0/0)');
  });
});
