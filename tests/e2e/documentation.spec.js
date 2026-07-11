// ── E2E: Documentation panel — full flow (#376) ───────────────────────────────
// Covers the complete Documentation feature end to end: JIRA filter (#370) →
// AI analysis (#371) → results/diff view (#372) → execute (#374/#375) → undo.
// All JIRA/AI/Confluence calls are mocked at the network level via
// page.route(), following the pattern established by piconfig.spec.js — the
// real backend is never exercised for these calls.
import { test, expect } from '@playwright/test';
import { clearDocsDir, rebuildServerIndex } from './fixtures.js';

test.beforeAll(async () => {
  clearDocsDir();
  await rebuildServerIndex();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const VERSIONS_FIXTURE = [
  { id: '1', name: 'v1.0', released: false, archived: false },
  { id: '2', name: 'v2.0', released: false, archived: false },
];

const ISSUE_FIXTURES = [
  {
    key: 'DOC-101',
    summary: 'Add SSO login flow',
    epicName: 'Auth',
    issuetype: 'Story',
    status: 'To Do',
    priority: 'Medium',
    fixVersions: ['v1.0'],
    localExists: false,
    localFilename: null,
    localDocType: null,
  },
  {
    key: 'DOC-102',
    summary: 'Fix SSO login redirect bug',
    epicName: 'Auth',
    issuetype: 'Bug',
    status: 'To Do',
    priority: 'High',
    fixVersions: ['v1.0'],
    localExists: false,
    localFilename: null,
    localDocType: null,
  },
  {
    key: 'DOC-103',
    summary: 'Auth revamp epic',
    epicName: '',
    issuetype: 'Epic',
    status: 'In Progress',
    priority: 'Medium',
    fixVersions: ['v2.0'],
    localExists: true,
    localFilename: '2026-01-01-auth-revamp.md',
    localDocType: 'epic',
  },
];

const SUGGESTIONS_FIXTURE = [
  {
    pageTitle: 'SSO Login Flow',
    hierarchyPath: 'Product Docs / Auth / SSO Login Flow',
    action: 'Update',
    currentContent: 'Line one\nOld line two\nLine three',
    proposedContent: 'Line one\nNew line two\nLine three',
  },
  {
    pageTitle: 'Auth Revamp Overview',
    hierarchyPath: 'Product Docs / Auth / Auth Revamp Overview',
    action: 'Create',
    currentContent: '',
    proposedContent: 'Brand new page content',
  },
];

const EXECUTE_SUCCESS = {
  snapshotId: 'snap-success-1',
  results: [
    { pageTitle: 'SSO Login Flow', action: 'Update', pageId: 'p1', success: true },
    { pageTitle: 'Auth Revamp Overview', action: 'Create', pageId: 'p2', success: true },
  ],
};

const EXECUTE_MIXED = {
  snapshotId: 'snap-mixed-1',
  results: [
    { pageTitle: 'SSO Login Flow', action: 'Update', pageId: 'p1', success: true },
    {
      pageTitle: 'Auth Revamp Overview',
      action: 'Create',
      pageId: null,
      success: false,
      error: 'Page already exists: Auth Revamp Overview',
    },
  ],
};

const EXECUTE_ALL_FAIL = {
  snapshotId: 'snap-all-fail-1',
  results: [
    {
      pageTitle: 'SSO Login Flow',
      action: 'Update',
      pageId: null,
      success: false,
      error: 'Page not found: SSO Login Flow',
    },
    {
      pageTitle: 'Auth Revamp Overview',
      action: 'Create',
      pageId: null,
      success: false,
      error: 'Confluence API error creating page',
    },
  ],
};

const UNDO_SUCCESS = {
  results: [
    { pageTitle: 'SSO Login Flow', action: 'Update', success: true },
    { pageTitle: 'Auth Revamp Overview', action: 'Create', success: true },
  ],
};

function filterIssues(issues, { type, text, fixVersion }) {
  return issues.filter((issue) => {
    if (type && type !== 'all') {
      const t = issue.issuetype.toLowerCase();
      if (type === 'story' && t !== 'story' && t !== 'improvement') return false;
      if (type === 'epic' && t !== 'epic') return false;
      if (type === 'bug' && t !== 'bug') return false;
    }
    if (text && !issue.summary.toLowerCase().includes(text.toLowerCase())) return false;
    if (fixVersion && !(issue.fixVersions || []).includes(fixVersion)) return false;
    return true;
  });
}

// ── Route mocking ────────────────────────────────────────────────────────────
// Mocks all five Documentation-panel endpoints in one place. `analyzeGate` /
// `executeGate` / `undoGate` accept a Promise the route handler awaits before
// fulfilling — used by the loading-state tests to pause a response until the
// test has observed the in-flight UI.
async function mockDocumentationRoutes(
  page,
  {
    versions = VERSIONS_FIXTURE,
    issues = ISSUE_FIXTURES,
    suggestions = SUGGESTIONS_FIXTURE,
    analyzeStatus = 200,
    executeResult = EXECUTE_SUCCESS,
    undoResult = UNDO_SUCCESS,
    analyzeGate = null,
    executeGate = null,
    undoGate = null,
  } = {}
) {
  await page.route('**/api/jira/versions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ versions }),
    })
  );

  await page.route('**/api/jira/search*', (route) => {
    const url = new URL(route.request().url());
    const filtered = filterIssues(issues, {
      type: url.searchParams.get('type') || 'all',
      text: url.searchParams.get('text') || '',
      fixVersion: url.searchParams.get('fixVersion') || '',
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ issues: filtered, total: filtered.length }),
    });
  });

  await page.route('**/api/confluence/analyze', async (route) => {
    if (analyzeGate) await analyzeGate;
    return route.fulfill({
      status: analyzeStatus,
      contentType: 'application/json',
      body:
        analyzeStatus === 200
          ? JSON.stringify({ suggestions })
          : JSON.stringify({ error: 'AI analysis failed', code: 'AI_ERROR' }),
    });
  });

  await page.route('**/api/confluence/execute', async (route) => {
    if (executeGate) await executeGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(executeResult),
    });
  });

  await page.route('**/api/confluence/undo/*', async (route) => {
    if (undoGate) await undoGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(undoResult),
    });
  });
}

// ── Flow helpers ─────────────────────────────────────────────────────────────
async function openDocView(page) {
  await page.goto('/');
  await page.locator('.sidebar-item[data-view="documentation"]').click();
  await expect(page.locator('#documentation-view')).toHaveClass(/show/);
  await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });
}

async function selectIssue(page, key) {
  await page.locator(`.doc-issue-row[data-key="${key}"] input[type=checkbox]`).check();
}

async function askAIAndWaitResults(page) {
  await page.locator('#doc-ask-ai-btn').click();
  await expect(page.locator('#doc-results-loading')).toBeHidden({ timeout: 5000 });
}

async function selectSuggestion(page, index) {
  await page.locator(`.doc-suggestion-row[data-index="${index}"] input[type=checkbox]`).check();
}

// ── Filter & selection ───────────────────────────────────────────────────────
test.describe('Documentation — navigation & filter panel', () => {
  test('clicking Documentation in the sidebar shows the filter panel, not a placeholder', async ({
    page,
  }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await expect(page.locator('#doc-filter-text')).toBeVisible();
    await expect(page.locator('#doc-filter-version')).toBeVisible();
    await expect(page.locator('#doc-type-chips')).toBeVisible();
    await expect(page.locator('.doc-issue-row')).toHaveCount(ISSUE_FIXTURES.length);
  });
});

test.describe('Documentation — JIRA search & filtering', () => {
  test('typing in the search input calls JIRA search and populates the list', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/jira/search') && r.url().includes('text=redirect')
      ),
      page.locator('#doc-filter-text').fill('redirect'),
    ]);

    await expect(page.locator('.doc-issue-row')).toHaveCount(1);
    await expect(page.locator('#doc-issues-list')).toContainText('DOC-102');
    await expect(page.locator('#doc-issues-list')).not.toContainText('DOC-101');
  });

  test('fix-version filter narrows the results', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/jira/search') && r.url().includes('fixVersion=v1.0')
      ),
      page.locator('#doc-filter-version').selectOption('v1.0'),
    ]);

    await expect(page.locator('.doc-issue-row')).toHaveCount(2);
    await expect(page.locator('#doc-issues-list')).toContainText('DOC-101');
    await expect(page.locator('#doc-issues-list')).toContainText('DOC-102');
    await expect(page.locator('#doc-issues-list')).not.toContainText('DOC-103');
  });
});

test.describe('Documentation — issue selection', () => {
  test('checking a row enables the "Ask AI" button', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
    await selectIssue(page, 'DOC-101');
    await expect(page.locator('#doc-ask-ai-btn')).toBeEnabled();
  });

  test('unchecking all rows disables the "Ask AI" button', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await selectIssue(page, 'DOC-101');
    await expect(page.locator('#doc-ask-ai-btn')).toBeEnabled();

    await page.locator('.doc-issue-row[data-key="DOC-101"] input[type=checkbox]').uncheck();
    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });
});

// ── AI analysis ──────────────────────────────────────────────────────────────
test.describe('Documentation — Ask AI loading state', () => {
  test('clicking "Ask AI" shows a loading state', async ({ page }) => {
    let releaseAnalyze;
    const gate = new Promise((resolve) => {
      releaseAnalyze = resolve;
    });
    await mockDocumentationRoutes(page, { analyzeGate: gate });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');

    await page.locator('#doc-ask-ai-btn').click();
    await expect(page.locator('#doc-results-panel')).toBeVisible();
    await expect(page.locator('#doc-results-loading')).toBeVisible({ timeout: 2000 });

    releaseAnalyze();
    await expect(page.locator('#doc-results-loading')).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Documentation — AI analysis results', () => {
  test('results list appears with at least one suggestion after the AI call resolves', async ({
    page,
  }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    await expect(page.locator('.doc-suggestion-row')).toHaveCount(SUGGESTIONS_FIXTURE.length);
  });

  test('each result row shows title, breadcrumb hierarchy, and a color-coded action badge', async ({
    page,
  }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    const first = page.locator('.doc-suggestion-row[data-index="0"]');
    await expect(first.locator('.doc-suggestion-title')).toHaveText('SSO Login Flow');
    await expect(first.locator('.doc-suggestion-path')).toHaveText(
      'Product Docs / Auth / SSO Login Flow'
    );
    await expect(first.locator('.doc-action-badge')).toHaveClass(/doc-action-update/);
    await expect(first.locator('.doc-action-badge')).toHaveText('Update');

    const second = page.locator('.doc-suggestion-row[data-index="1"]');
    await expect(second.locator('.doc-action-badge')).toHaveClass(/doc-action-create/);
    await expect(second.locator('.doc-action-badge')).toHaveText('Create');
  });

  test('clicking a result row expands the diff view, and clicking it again collapses it', async ({
    page,
  }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    const row = page.locator('.doc-suggestion-row[data-index="0"]');
    // .doc-diff-content itself isn't clipped in its own layout box — the
    // collapse is done by the ancestor .doc-diff-inner (overflow:hidden,
    // min-height:0) sitting in a grid-template-rows:0fr track, so that's the
    // element whose bounding box actually collapses to zero height.
    const diffInner = row.locator('.doc-diff-inner');

    await expect(diffInner).toBeHidden();

    await row.locator('.doc-suggestion-chevron').click();
    await expect(row).toHaveClass(/expanded/);
    await expect(diffInner).toBeVisible({ timeout: 2000 });

    await row.locator('.doc-suggestion-chevron').click();
    await expect(row).not.toHaveClass(/expanded/);
    await expect(diffInner).toBeHidden({ timeout: 2000 });
  });

  test('diff view shows red (removed) and green (added) lines', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    const row = page.locator('.doc-suggestion-row[data-index="0"]');
    await row.locator('.doc-suggestion-chevron').click();

    await expect(row.locator('.diff-remove')).toContainText('Old line two');
    await expect(row.locator('.diff-add')).toContainText('New line two');
  });
});

test.describe('Documentation — AI results selection controls', () => {
  // The issue's "Select All checks all rows; Deselect All unchecks all" bullet
  // is listed under "Filter & selection", but documentation.ts / index.html
  // only wire up #doc-results-toolbar's Select All / Deselect All buttons for
  // the AI *suggestions* list (selectAllSuggestions/deselectAllSuggestions) —
  // there is no such control for the JIRA issue list. Tested against its
  // actual location.
  test('"Select All" checks all suggestion rows; "Deselect All" unchecks all', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    const toolbar = page.locator('#doc-results-toolbar');
    // ":has-text" is a substring match, and "Deselect All" contains "Select
    // All" as a substring — use an exact accessible-name match instead.
    await toolbar.getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(
      page.locator('.doc-suggestion-row[data-index="0"] input[type=checkbox]')
    ).toBeChecked();
    await expect(
      page.locator('.doc-suggestion-row[data-index="1"] input[type=checkbox]')
    ).toBeChecked();
    await expect(page.locator('#doc-results-selection-count')).toContainText('2 of 2 selected');

    await toolbar.getByRole('button', { name: 'Deselect All', exact: true }).click();
    await expect(
      page.locator('.doc-suggestion-row[data-index="0"] input[type=checkbox]')
    ).not.toBeChecked();
    await expect(
      page.locator('.doc-suggestion-row[data-index="1"] input[type=checkbox]')
    ).not.toBeChecked();
  });
});

// ── Execute flow ─────────────────────────────────────────────────────────────
test.describe('Documentation — execute (Modify Documentation)', () => {
  test('checking suggestions and clicking "Modify Documentation" shows per-item spinners', async ({
    page,
  }) => {
    let releaseExecute;
    const gate = new Promise((resolve) => {
      releaseExecute = resolve;
    });
    await mockDocumentationRoutes(page, { executeGate: gate, executeResult: EXECUTE_SUCCESS });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);
    await selectSuggestion(page, 0);
    await selectSuggestion(page, 1);

    await page.locator('#doc-modify-btn').click();
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveClass(/spinner/);
    await expect(page.locator('.doc-suggestion-status[data-index="1"]')).toHaveClass(/spinner/);

    releaseExecute();
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveClass(/success/, {
      timeout: 5000,
    });
  });

  test('after execution, each row shows a success or error status icon', async ({ page }) => {
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_MIXED });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);
    await selectSuggestion(page, 0);
    await selectSuggestion(page, 1);

    await page.locator('#doc-modify-btn').click();

    const successStatus = page.locator('.doc-suggestion-status[data-index="0"]');
    await expect(successStatus).toHaveClass(/success/, { timeout: 5000 });
    await expect(successStatus).toHaveText('✓');

    const errorStatus = page.locator('.doc-suggestion-status[data-index="1"]');
    await expect(errorStatus).toHaveClass(/error/, { timeout: 5000 });
    await expect(errorStatus).toHaveText('✗');
    await expect(page.locator('.doc-suggestion-error-text[data-index="1"]')).toContainText(
      'Page already exists'
    );
  });

  test('"Modify Documentation" button is disabled after execution', async ({ page }) => {
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_SUCCESS });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);
    await selectSuggestion(page, 0);
    await selectSuggestion(page, 1);

    await page.locator('#doc-modify-btn').click();
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveClass(/success/, {
      timeout: 5000,
    });
    await expect(page.locator('#doc-modify-btn')).toBeDisabled();
  });

  test('"↩ Undo all changes" button appears after at least one successful operation', async ({
    page,
  }) => {
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_MIXED });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);
    await selectSuggestion(page, 0);
    await selectSuggestion(page, 1);

    await page.locator('#doc-modify-btn').click();
    await expect(page.locator('#doc-undo-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#doc-undo-btn')).toContainText('Undo all changes');
    await expect(page.locator('#doc-undo-btn')).toContainText('60s');
  });
});

// ── Undo ─────────────────────────────────────────────────────────────────────
async function executeAndReachUndo(page, executeResult = EXECUTE_SUCCESS) {
  await openDocView(page);
  await selectIssue(page, 'DOC-101');
  await askAIAndWaitResults(page);
  await selectSuggestion(page, 0);
  await selectSuggestion(page, 1);
  await page.locator('#doc-modify-btn').click();
  await expect(page.locator('#doc-undo-btn')).toBeVisible({ timeout: 5000 });
  void executeResult;
}

test.describe('Documentation — undo', () => {
  test('undo count-down label ticks down every second', async ({ page }) => {
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_SUCCESS });
    await executeAndReachUndo(page);

    await expect(page.locator('#doc-undo-btn')).toContainText('(60s)');
    // A short real wait is enough to prove the interval is live-updating —
    // no need for the full 60s here (see the dedicated expiry test below).
    await expect(page.locator('#doc-undo-btn')).toContainText('(59s)', { timeout: 2000 });
  });

  test('clicking "↩ Undo all changes" shows a spinner on the button, then a success toast', async ({
    page,
  }) => {
    let releaseUndo;
    const gate = new Promise((resolve) => {
      releaseUndo = resolve;
    });
    await mockDocumentationRoutes(page, {
      executeResult: EXECUTE_SUCCESS,
      undoResult: UNDO_SUCCESS,
      undoGate: gate,
    });
    await executeAndReachUndo(page);

    await page.locator('#doc-undo-btn').click();
    await expect(page.locator('#doc-undo-btn')).toBeDisabled();
    await expect(page.locator('#doc-undo-btn')).toHaveClass(/doc-undo-btn-loading/);
    await expect(page.locator('#doc-undo-btn')).toContainText('Undoing');

    releaseUndo();
    await expect(page.locator('#jira-push-toast')).toHaveClass(/success/, { timeout: 5000 });
    await expect(page.locator('#jira-push-toast')).toContainText('Changes reverted');
  });

  test('results list resets to pre-execution state after undo', async ({ page }) => {
    await mockDocumentationRoutes(page, {
      executeResult: EXECUTE_SUCCESS,
      undoResult: UNDO_SUCCESS,
    });
    await executeAndReachUndo(page);

    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveClass(/success/);

    await page.locator('#doc-undo-btn').click();
    await expect(page.locator('#jira-push-toast')).toHaveClass(/success/, { timeout: 5000 });

    // Status icons are cleared and the undo button is gone — back to the
    // pre-execution state. Selections are preserved (renderAnalysisResults
    // re-renders from the still-selected suggestion indexes).
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveText('');
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).not.toHaveClass(
      /success|error/
    );
    await expect(page.locator('#doc-undo-btn')).toBeHidden();
    await expect(
      page.locator('.doc-suggestion-row[data-index="0"] input[type=checkbox]')
    ).toBeChecked();
  });

  test('undo button disappears 60 seconds after execution, without clicking', async ({ page }) => {
    // Uses Playwright's Clock API to fast-forward the browser's virtual
    // timers rather than a real 60s wait — the undo countdown uses a plain
    // setInterval(…, 1000) (see _startUndoCountdownTimer in documentation.ts),
    // which the Clock API can intercept as long as it's installed before the
    // interval is created, i.e. before the execute click below.
    // clock.fastForward() only fires each due timer at most once (it's meant
    // to simulate "closing the laptop lid"), so a 61s jump would fire the
    // setInterval callback only once, not 61 times — clock.runFor() instead
    // fires every due callback along the way, which is what a ticking
    // countdown needs.
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_SUCCESS });
    await page.clock.install();

    await executeAndReachUndo(page);
    await expect(page.locator('#doc-undo-btn')).toContainText('(60s)');

    await page.clock.runFor('01:01');
    await expect(page.locator('#doc-undo-btn')).toBeHidden();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────
test.describe('Documentation — edge cases', () => {
  test('zero JIRA results shows an empty state in the filter list', async ({ page }) => {
    await mockDocumentationRoutes(page, { issues: [] });
    await openDocView(page);

    await expect(page.locator('#doc-issues-list')).toContainText(
      'No JIRA issues match the current filters.'
    );
    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });

  test('AI returns zero suggestions shows an empty state in the results list', async ({ page }) => {
    await mockDocumentationRoutes(page, { suggestions: [] });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);

    await expect(page.locator('#doc-results-list')).toContainText(
      'No documentation changes were suggested for the selected issues.'
    );
    await expect(page.locator('#doc-results-toolbar')).toBeHidden();
  });

  test('all operations failing leaves "Modify Documentation" in its post-click disabled state', async ({
    page,
  }) => {
    // NOTE — real app bug: the issue's acceptance criteria says
    // "Modify Documentation" should stay ENABLED after a total failure so
    // the user can retry. In documentation.ts's executeChanges(), modifyBtn
    // is unconditionally disabled at the start of the call (`modifyBtn.disabled
    // = true`) and is never re-enabled on the success *or* failure paths —
    // _updateSuggestionSelectionState() (the only code that re-enables it) is
    // not invoked anywhere in executeChanges(). So today, the button stays
    // disabled even when every operation fails; the user must toggle a
    // suggestion checkbox to re-enable it. This test documents the ACTUAL
    // current behavior (disabled) per the task instructions — it was not
    // fixed here since this issue is test-only. See the final report.
    await mockDocumentationRoutes(page, { executeResult: EXECUTE_ALL_FAIL });
    await openDocView(page);
    await selectIssue(page, 'DOC-101');
    await askAIAndWaitResults(page);
    await selectSuggestion(page, 0);
    await selectSuggestion(page, 1);

    await page.locator('#doc-modify-btn').click();
    await expect(page.locator('.doc-suggestion-status[data-index="0"]')).toHaveClass(/error/, {
      timeout: 5000,
    });
    await expect(page.locator('.doc-suggestion-status[data-index="1"]')).toHaveClass(/error/);
    await expect(page.locator('#doc-modify-btn')).toBeDisabled();
    await expect(page.locator('#doc-undo-btn')).toBeHidden();
  });

  test('no overlapping panels — only the Documentation panel is visible', async ({ page }) => {
    await mockDocumentationRoutes(page);
    await openDocView(page);

    await expect(page.locator('#documentation-view')).toBeVisible();
    await expect(page.locator('#settings-view')).toBeHidden();
    await expect(page.locator('#bugs-view')).toBeHidden();
    await expect(page.locator('#skills-view')).toBeHidden();
    await expect(page.locator('#roadmap-view')).toBeHidden();
    await expect(page.locator('#list-view')).toBeHidden();
    await expect(page.locator('.dialog-overlay.show')).toHaveCount(0);
  });
});
