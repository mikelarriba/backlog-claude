// ── E2E: Documentation panel — bulk-select flow (#387) ───────────────────────
// Covers the redesigned Documentation panel introduced in #384/#385/#386:
//   • No auto-search on open (placeholder shown instead)
//   • Three-tab mode switcher: By Sprint / By Fix Version / Search Issues
//   • Sprint and fix-version modes load all issues and pre-select them
//   • Search mode requires explicit trigger (Enter or Search button)
//   • Mode switching with a non-empty selection prompts for confirmation
//   • JIRA-not-configured error path
//
// All JIRA/Confluence calls are mocked at the network level via page.route(),
// following the pattern established in documentation.spec.js.
import { test, expect } from '@playwright/test';
import { clearDocsDir } from './fixtures.js';

test.beforeAll(() => {
  // Clear any leftover fixture docs; no rebuild needed because all network
  // calls in this file are intercepted via page.route() — the real server
  // endpoints are never exercised.
  clearDocsDir();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SPRINTS_FIXTURE = [
  { id: 1, name: 'Sprint 10', state: 'active' },
  { id: 2, name: 'Sprint 11', state: 'future' },
];

const VERSIONS_FIXTURE = [
  { id: '1', name: 'v1.0', released: false, archived: false },
  { id: '2', name: 'v2.0', released: false, archived: false },
];

const ISSUE_FIXTURES = [
  {
    key: 'BS-101',
    summary: 'Implement login flow',
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
    key: 'BS-102',
    summary: 'Fix redirect bug',
    epicName: 'Auth',
    issuetype: 'Bug',
    status: 'In Progress',
    priority: 'High',
    fixVersions: ['v1.0'],
    localExists: false,
    localFilename: null,
    localDocType: null,
  },
  {
    key: 'BS-103',
    summary: 'Auth epic overview',
    epicName: '',
    issuetype: 'Epic',
    status: 'In Progress',
    priority: 'Medium',
    fixVersions: ['v2.0'],
    localExists: true,
    localFilename: '2026-01-01-auth-epic.md',
    localDocType: 'epic',
  },
];

// ── Route mocking ─────────────────────────────────────────────────────────────
async function mockDocRoutes(
  page,
  {
    sprints = SPRINTS_FIXTURE,
    versions = VERSIONS_FIXTURE,
    issues = ISSUE_FIXTURES,
    jiraConnected = true,
  } = {}
) {
  await page.route('**/api/jira/board-sprints', (route) => {
    if (!jiraConnected) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'JIRA not configured', code: 'JIRA_NOT_CONFIGURED' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sprints }),
    });
  });

  await page.route('**/api/jira/versions', (route) => {
    if (!jiraConnected) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'JIRA not configured', code: 'JIRA_NOT_CONFIGURED' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ versions }),
    });
  });

  await page.route('**/api/jira/search*', (route) => {
    if (!jiraConnected) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'JIRA not configured', code: 'JIRA_NOT_CONFIGURED' }),
      });
    }
    const url = new URL(route.request().url());
    const sprint = url.searchParams.get('sprint') || '';
    const fixVersion = url.searchParams.get('fixVersion') || '';
    const text = url.searchParams.get('text') || '';
    const type = url.searchParams.get('type') || 'all';

    let filtered = issues.filter((i) => {
      if (sprint && !(i.sprint === sprint)) {
        // sprint filtering: return all issues when sprint is set (simulating real JIRA response)
        // In the fixture all issues belong to the sprint when one is selected
        return true;
      }
      if (fixVersion && !(i.fixVersions || []).includes(fixVersion)) return false;
      if (text && !i.summary.toLowerCase().includes(text.toLowerCase())) return false;
      if (type !== 'all') {
        const t = i.issuetype.toLowerCase();
        if (type === 'story' && t !== 'story' && t !== 'improvement') return false;
        if (type === 'epic' && t !== 'epic') return false;
        if (type === 'bug' && t !== 'bug') return false;
      }
      return true;
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ issues: filtered, total: filtered.length }),
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function openDocView(page) {
  await page.goto('/');
  await page.locator('.sidebar-item[data-view="documentation"]').click();
  await expect(page.locator('#documentation-view')).toHaveClass(/show/);
  // Wait for the initial board-sprints + versions requests to settle
  await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });
}

// ── Panel open state (#384) ───────────────────────────────────────────────────
test.describe('Documentation — panel open state', () => {
  test('shows placeholder and no issue rows on open', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await expect(page.locator('#doc-placeholder')).toBeVisible();
    await expect(page.locator('.doc-issue-row')).toHaveCount(0);
  });

  test('mode switcher is visible with three tabs', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await expect(page.locator('.doc-mode-tab[data-mode="sprint"]')).toBeVisible();
    await expect(page.locator('.doc-mode-tab[data-mode="fixversion"]')).toBeVisible();
    await expect(page.locator('.doc-mode-tab[data-mode="search"]')).toBeVisible();
  });

  test('"By Sprint" tab is active and sprint panel is visible by default', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await expect(page.locator('.doc-mode-tab[data-mode="sprint"]')).toHaveClass(/active/);
    await expect(page.locator('#doc-mode-sprint')).toHaveClass(/active/);
    await expect(page.locator('#doc-sprint-select')).toBeVisible();
  });

  test('"Ask AI" button is disabled on open', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });
});

// ── By Sprint mode (#386) ─────────────────────────────────────────────────────
test.describe('Documentation — By Sprint mode', () => {
  test('sprint dropdown is populated with available sprints', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    const select = page.locator('#doc-sprint-select');
    await expect(select.locator('option[value="Sprint 10"]')).toHaveCount(1);
    await expect(select.locator('option[value="Sprint 11"]')).toHaveCount(1);
  });

  test('selecting a sprint shows loading then renders all issues pre-checked', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);

    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('.doc-issue-row')).toHaveCount(ISSUE_FIXTURES.length);

    // All checkboxes should be checked
    const checkboxes = page.locator('.doc-issue-row input[type=checkbox]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('selection count shows "N issues loaded — all selected" after sprint load', async ({
    page,
  }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    const countEl = page.locator('#doc-selection-count');
    await expect(countEl).toContainText('all selected');
  });

  test('"Ask AI" button is enabled immediately after sprint load', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    await expect(page.locator('#doc-ask-ai-btn')).toBeEnabled();
  });

  test('unchecking one row reduces the count label', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    // Uncheck the first row
    await page.locator('.doc-issue-row input[type=checkbox]').first().uncheck();

    const countEl = page.locator('#doc-selection-count');
    await expect(countEl).toContainText(`${ISSUE_FIXTURES.length - 1} of ${ISSUE_FIXTURES.length}`);
    await expect(countEl).not.toContainText('all selected');
  });

  test('unchecking all rows disables "Ask AI"', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    const checkboxes = page.locator('.doc-issue-row input[type=checkbox]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).uncheck();
    }

    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });

  test('clicking a deselected row re-checks it and re-enables "Ask AI"', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    // Uncheck all
    const checkboxes = page.locator('.doc-issue-row input[type=checkbox]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).uncheck();
    }
    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();

    // Re-check first row by clicking the row itself
    await page.locator('.doc-issue-row').first().click();
    await expect(page.locator('#doc-ask-ai-btn')).toBeEnabled();
  });
});

// ── By Fix Version mode (#386) ────────────────────────────────────────────────
test.describe('Documentation — By Fix Version mode', () => {
  test('clicking "By Fix Version" tab shows the fix version dropdown', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    await expect(page.locator('#doc-mode-fixversion')).toHaveClass(/active/);
    await expect(page.locator('#doc-filter-version')).toBeVisible();
  });

  test('fix version dropdown is populated', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    const select = page.locator('#doc-filter-version');
    await expect(select.locator('option[value="v1.0"]')).toHaveCount(1);
    await expect(select.locator('option[value="v2.0"]')).toHaveCount(1);
  });

  test('selecting a fix version loads issues and pre-selects all', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-filter-version').selectOption('v1.0'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    // v1.0 matches BS-101 and BS-102
    const rows = page.locator('.doc-issue-row');
    await expect(rows).toHaveCount(2);

    const checkboxes = page.locator('.doc-issue-row input[type=checkbox]');
    await expect(checkboxes.nth(0)).toBeChecked();
    await expect(checkboxes.nth(1)).toBeChecked();
  });

  test('"Ask AI" is enabled immediately after fix version load', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-filter-version').selectOption('v1.0'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    await expect(page.locator('#doc-ask-ai-btn')).toBeEnabled();
  });
});

// ── Search Issues mode (#384) ─────────────────────────────────────────────────
test.describe('Documentation — Search Issues mode', () => {
  test('clicking "Search Issues" tab shows text input, type chips, and Search button', async ({
    page,
  }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="search"]').click();

    await expect(page.locator('#doc-mode-search')).toHaveClass(/active/);
    await expect(page.locator('#doc-filter-text')).toBeVisible();
    await expect(page.locator('.doc-type-chips')).toBeVisible();
    await expect(page.locator('.doc-search-btn')).toBeVisible();
  });

  test('typing alone does NOT trigger a search', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="search"]').click();

    let searchFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/jira/search')) searchFired = true;
    });

    await page.locator('#doc-filter-text').fill('login');
    // Short wait to confirm no request was fired
    await page.waitForTimeout(400);

    expect(searchFired).toBe(false);
    await expect(page.locator('.doc-issue-row')).toHaveCount(0);
    await expect(page.locator('#doc-placeholder')).toBeVisible();
  });

  test('pressing Enter fires the search and renders results', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="search"]').click();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-filter-text').fill('login'),
      page.locator('#doc-filter-text').press('Enter'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    await expect(page.locator('.doc-issue-row')).toHaveCount(1);
    await expect(page.locator('#doc-issues-list')).toContainText('BS-101');
  });

  test('clicking Search button fires the search', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="search"]').click();

    await page.locator('#doc-filter-text').fill('redirect');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('.doc-search-btn').click(),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    await expect(page.locator('.doc-issue-row')).toHaveCount(1);
    await expect(page.locator('#doc-issues-list')).toContainText('BS-102');
  });

  test('search results are NOT pre-selected', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    await page.locator('.doc-mode-tab[data-mode="search"]').click();

    await page.locator('#doc-filter-text').fill('');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('.doc-search-btn').click(),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    const checkboxes = page.locator('.doc-issue-row input[type=checkbox]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });
});

// ── Mode switching ────────────────────────────────────────────────────────────
test.describe('Documentation — mode switching', () => {
  test('switching mode with no selection clears list and shows placeholder', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    // Switch to fix version then back to sprint — no selection, no confirmation needed
    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();
    await page.locator('.doc-mode-tab[data-mode="sprint"]').click();

    await expect(page.locator('#doc-placeholder')).toBeVisible();
    await expect(page.locator('.doc-issue-row')).toHaveCount(0);
  });

  test('switching mode with a selection shows confirmation prompt', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    // Load sprint issues (auto-selects all)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    // Set up dialog handler to dismiss (cancel)
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    // Should still be on sprint mode — list unchanged
    await expect(page.locator('.doc-mode-tab[data-mode="sprint"]')).toHaveClass(/active/);
    await expect(page.locator('.doc-issue-row')).toHaveCount(ISSUE_FIXTURES.length);
  });

  test('confirming mode switch clears list and selection', async ({ page }) => {
    await mockDocRoutes(page);
    await openDocView(page);

    // Load sprint issues
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);
    await expect(page.locator('#doc-loading')).toBeHidden({ timeout: 5000 });

    // Accept the confirmation dialog
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.doc-mode-tab[data-mode="fixversion"]').click();

    await expect(page.locator('.doc-mode-tab[data-mode="fixversion"]')).toHaveClass(/active/);
    await expect(page.locator('.doc-issue-row')).toHaveCount(0);
    await expect(page.locator('#doc-placeholder')).toBeVisible();
    await expect(page.locator('#doc-ask-ai-btn')).toBeDisabled();
  });
});

// ── JIRA not configured ───────────────────────────────────────────────────────
test.describe('Documentation — JIRA not configured', () => {
  test('selecting a sprint when JIRA search fails shows JIRA not connected banner', async ({
    page,
  }) => {
    // Board-sprints succeeds so the dropdown is populated, but the search
    // endpoint returns JIRA_NOT_CONFIGURED — triggering _showDocError.
    await page.route('**/api/jira/board-sprints', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sprints: SPRINTS_FIXTURE }),
      })
    );
    await page.route('**/api/jira/versions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ versions: VERSIONS_FIXTURE }),
      })
    );
    await page.route('**/api/jira/search*', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        // fetchJSON throws new Error(errData.error) — _showDocError checks
        // message.includes('JIRA_NOT_CONFIGURED') to set the "JIRA not connected" title.
        body: JSON.stringify({ error: 'JIRA_NOT_CONFIGURED' }),
      })
    );

    await openDocView(page);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jira/search')),
      page.locator('#doc-sprint-select').selectOption('Sprint 10'),
    ]);

    await expect(page.locator('#doc-error-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#doc-error-banner')).toContainText('JIRA not connected');
  });
});
