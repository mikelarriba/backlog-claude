// ── E2E: PI Config panel — "↓ Sync from JIRA" button (#350) ──────────────────
// Covers importing new JIRA issues for a PI's fix version, distinct from the
// "Check JIRA" sync flow which only refreshes issues that already exist locally.
import { test, expect } from '@playwright/test';
import { clearDocsDir, rebuildServerIndex } from './fixtures.js';

const PI_VERSION = 'PI-2026.1-sync-test';

// The PUT schema only accepts `string | undefined` for currentPi/nextPi (not
// `null`), so "unsetting" a PI means omitting the field entirely rather than
// sending an explicit null — the backend then defaults it to null itself.
async function setPiSettings(currentPi, nextPi = null) {
  const body = {};
  if (currentPi) body.currentPi = currentPi;
  if (nextPi) body.nextPi = nextPi;
  const res = await fetch('http://localhost:3000/api/settings/pi', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to set PI settings: ${res.status}`);
}

async function openPiConfigPanel(page) {
  await page.goto('/');
  await page.locator('.sidebar-item[data-view="settings"]').click();
  await expect(page.locator('#settings-view')).toBeVisible({ timeout: 5000 });
  await page.locator('.pi-config-section .collapsible-header').click();
  await expect(page.locator('#pi-config-body')).toHaveClass(/open/, { timeout: 5000 });
}

test.beforeAll(async () => {
  clearDocsDir();
  await rebuildServerIndex();
});

test.afterAll(async () => {
  // Leave PI settings clean for other spec files running in the same server.
  await setPiSettings(null, null);
});

test.describe('PI Config — Sync from JIRA button visibility', () => {
  test('button is visible below both the Current PI and Next PI selects', async ({ page }) => {
    await setPiSettings(null, null);
    await openPiConfigPanel(page);

    await expect(page.locator('#pi-config-sync-btn-currentPi')).toBeVisible();
    await expect(page.locator('#pi-config-sync-btn-currentPi')).toContainText('Sync from JIRA');
    await expect(page.locator('#pi-config-sync-btn-nextPi')).toBeVisible();
  });
});

test.describe('PI Config — Sync from JIRA: fix version not set', () => {
  test('shows an informative error toast and does not open the modal', async ({ page }) => {
    await setPiSettings(null, null);
    await openPiConfigPanel(page);

    await page.locator('#pi-config-sync-btn-currentPi').click();

    await expect(page.locator('#jira-push-toast')).toHaveClass(/error/, { timeout: 3000 });
    await expect(page.locator('#jira-push-toast')).toContainText(/fix version/i);
    await expect(page.locator('#jira-select-overlay')).not.toHaveClass(/show/);
  });
});

test.describe('PI Config — Sync from JIRA: modal listing (mocked)', () => {
  test.beforeEach(async () => {
    await setPiSettings(PI_VERSION, null);
  });

  test('clicking Sync opens a modal listing JIRA issues; local one flagged as already imported', async ({
    page,
  }) => {
    await page.route('**/api/jira/by-fix-version/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fixVersion: PI_VERSION,
          total: 2,
          issues: [
            {
              key: 'PROJ-1',
              summary: 'Brand new story from JIRA',
              issuetype: 'Story',
              status: 'To Do',
              priority: 'Medium',
              localExists: false,
              localFilename: null,
            },
            {
              key: 'PROJ-2',
              summary: 'Story already pulled locally',
              issuetype: 'Story',
              status: 'Done',
              priority: 'Medium',
              localExists: true,
              localFilename: '2026-01-01-story-already-pulled-locally.md',
            },
          ],
        }),
      })
    );

    await openPiConfigPanel(page);
    await page.locator('#pi-config-sync-btn-currentPi').click();

    await expect(page.locator('#jira-select-overlay')).toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#jira-select-list')).toContainText('Brand new story from JIRA');
    await expect(page.locator('#jira-select-list')).toContainText('Story already pulled locally');
    // Already-imported issue is flagged distinctly (informational, not the "+ New" badge)
    await expect(page.locator('#jira-select-list')).toContainText(/already imported/i);

    await page.locator('.jira-select-dialog .dialog-actions button:has-text("Cancel")').click();
  });

  test('selecting the new issue and confirming completes the import without error', async ({
    page,
  }) => {
    await page.route('**/api/jira/by-fix-version/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          fixVersion: PI_VERSION,
          total: 1,
          issues: [
            {
              key: 'PROJ-3',
              summary: 'Story to import',
              issuetype: 'Story',
              status: 'To Do',
              priority: 'Medium',
              localExists: false,
              localFilename: null,
            },
          ],
        }),
      })
    );
    await page.route('**/api/jira/pull', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pulled: [{ key: 'PROJ-3', docType: 'story', filename: '2026-07-07-story-to-import.md' }],
          conflicts: [],
        }),
      })
    );

    await openPiConfigPanel(page);
    await page.locator('#pi-config-sync-btn-currentPi').click();
    await expect(page.locator('#jira-select-overlay')).toHaveClass(/show/, { timeout: 5000 });

    // The single new issue is pre-checked by default; confirm the import.
    await page.locator('#jira-select-confirm-btn').click();

    await expect(page.locator('#jira-select-overlay')).not.toHaveClass(/show/, { timeout: 5000 });
    await expect(page.locator('#jira-push-toast')).toHaveClass(/success/, { timeout: 5000 });
  });
});

test.describe('PI Config — Sync from JIRA: loading state', () => {
  test('button is disabled and shows a spinner while the request is in flight', async ({
    page,
  }) => {
    await setPiSettings(PI_VERSION, null);

    let releaseRoute;
    const gate = new Promise((resolve) => {
      releaseRoute = resolve;
    });
    await page.route('**/api/jira/by-fix-version/**', async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fixVersion: PI_VERSION, total: 0, issues: [] }),
      });
    });

    await openPiConfigPanel(page);
    const btn = page.locator('#pi-config-sync-btn-currentPi');
    await btn.click();

    await expect(btn).toBeDisabled({ timeout: 2000 });
    await expect(btn.locator('.spinner')).toBeVisible();

    releaseRoute();
    await expect(btn).toBeEnabled({ timeout: 5000 });
  });
});
