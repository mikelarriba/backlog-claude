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

async function putSprints(piName, sprints) {
  const res = await fetch(
    `http://localhost:3000/api/settings/pi/sprints/${encodeURIComponent(piName)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprints }),
    }
  );
  if (!res.ok) throw new Error(`Failed to set sprints: ${res.status}`);
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

// ── E2E: Sprint auto-suggestion from JIRA board (#352) ────────────────────────
// A PI with no sprints configured offers to auto-suggest sprint names/dates
// from the JIRA board (GET /api/jira/board-sprints), pre-filling the grid with
// a default capacity the user can then adjust before saving.
const JIRA_BOARD_SPRINTS = [
  { id: 101, name: 'PI Sprint 1', state: 'active', startDate: '2026-01-05', endDate: '2026-01-19' },
  { id: 102, name: 'PI Sprint 2', state: 'future', startDate: '2026-01-19', endDate: '2026-02-02' },
];

// Unique per test run so re-running the suite locally (which reuses the
// same .pi-settings.json across runs) never collides with sprints persisted
// by a previous run under the same PI name.
const RUN_ID = Date.now();

async function mockBoardSprints(page, body) {
  await page.route('**/api/jira/board-sprints', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

test.describe('PI Config — JIRA sprint auto-suggestion: banner appears for empty sprints', () => {
  test('inline banner offers to import sprints from JIRA', async ({ page }) => {
    const piName = `PI-2026.1-jira-import-offer-${RUN_ID}`;
    await setPiSettings(piName, null);
    await mockBoardSprints(page, { sprints: JIRA_BOARD_SPRINTS });

    await openPiConfigPanel(page);

    const banner = page.locator('#pi-config-jira-banner');
    await expect(banner).toContainText(/no sprints configured for this pi/i);
    await expect(banner).toContainText(/import sprint names from jira/i);
    await expect(banner.locator('button:has-text("Import")')).toBeVisible();
    await expect(banner.locator('button:has-text("Skip")')).toBeVisible();
  });
});

test.describe('PI Config — JIRA sprint auto-suggestion: Import populates the grid', () => {
  test('clicking Import pre-fills sprint rows with JIRA names and 70 SP capacity', async ({
    page,
  }) => {
    const piName = `PI-2026.1-jira-import-confirm-${RUN_ID}`;
    await setPiSettings(piName, null);
    await mockBoardSprints(page, { sprints: JIRA_BOARD_SPRINTS });

    await openPiConfigPanel(page);
    await page.locator('#pi-config-jira-banner button:has-text("Import")').click();

    const rows = page.locator('.pi-config-sprint-row');
    await expect(rows).toHaveCount(JIRA_BOARD_SPRINTS.length);
    for (let i = 0; i < JIRA_BOARD_SPRINTS.length; i++) {
      await expect(rows.nth(i).locator('.pi-config-sprint-name')).toHaveValue(
        JIRA_BOARD_SPRINTS[i].name
      );
      await expect(rows.nth(i).locator('.pi-config-sprint-cap')).toHaveValue('70');
    }

    // Banner switches to a confirmation summary rather than staying on the offer.
    const banner = page.locator('#pi-config-jira-banner');
    await expect(banner).toContainText(/found 2 sprints/i);
    await expect(banner).toContainText(/70 sp/i);
    await expect(banner.locator('button:has-text("Import")')).toHaveCount(0);
  });

  test('user can adjust an imported row capacity and save it', async ({ page }) => {
    const piName = `PI-2026.1-jira-import-save-${RUN_ID}`;
    await setPiSettings(piName, null);
    await mockBoardSprints(page, { sprints: JIRA_BOARD_SPRINTS });

    let savedBody = null;
    await page.route(`**/api/settings/pi/sprints/${encodeURIComponent(piName)}`, (route) => {
      if (route.request().method() === 'PUT') {
        savedBody = route.request().postDataJSON();
      }
      return route.continue();
    });

    await openPiConfigPanel(page);
    await page.locator('#pi-config-jira-banner button:has-text("Import")').click();

    const firstCapInput = page
      .locator('.pi-config-sprint-row')
      .first()
      .locator('.pi-config-sprint-cap');
    await firstCapInput.fill('55');
    await page.locator('#pi-config-save-btn').click();

    await expect(page.locator('#pi-config-status')).toHaveClass(/success/, { timeout: 5000 });
    expect(savedBody).not.toBeNull();
    expect(savedBody.sprints[0]).toMatchObject({ name: JIRA_BOARD_SPRINTS[0].name, capacity: 55 });
    expect(savedBody.sprints[1]).toMatchObject({ name: JIRA_BOARD_SPRINTS[1].name, capacity: 70 });

    // Persisted server-side too.
    const res = await fetch(
      `http://localhost:3000/api/settings/pi/sprints/${encodeURIComponent(piName)}`
    );
    const data = await res.json();
    expect(data.sprints[0]).toMatchObject({ name: JIRA_BOARD_SPRINTS[0].name, capacity: 55 });
  });
});

test.describe('PI Config — JIRA sprint auto-suggestion: Skip dismisses the offer', () => {
  test('clicking Skip shows the static hint and leaves the grid empty', async ({ page }) => {
    const piName = `PI-2026.1-jira-import-skip-${RUN_ID}`;
    await setPiSettings(piName, null);
    await mockBoardSprints(page, { sprints: JIRA_BOARD_SPRINTS });

    await openPiConfigPanel(page);
    const banner = page.locator('#pi-config-jira-banner');
    await banner.locator('button:has-text("Skip")').click();

    await expect(banner.locator('button:has-text("Import")')).toHaveCount(0);
    await expect(banner.locator('button:has-text("Skip")')).toHaveCount(0);
    await expect(banner).toContainText(/add sprints manually using the grid below/i);

    await expect(page.locator('.pi-config-sprint-row')).toHaveCount(0);
    await expect(page.locator('.pi-config-empty')).toContainText(/no sprints defined/i);
  });
});

test.describe('PI Config — JIRA sprint auto-suggestion: board not configured', () => {
  test('shows only the static hint, with no Import option, when boardNotConfigured is true', async ({
    page,
  }) => {
    const piName = `PI-2026.1-jira-board-not-configured-${RUN_ID}`;
    await setPiSettings(piName, null);
    await mockBoardSprints(page, { sprints: [], boardNotConfigured: true });

    await openPiConfigPanel(page);

    const banner = page.locator('#pi-config-jira-banner');
    await expect(banner).toContainText(/add sprints manually using the grid below/i);
    await expect(banner.locator('button:has-text("Import")')).toHaveCount(0);
    await expect(banner.locator('button:has-text("Skip")')).toHaveCount(0);
  });
});

test.describe('PI Config — JIRA sprint auto-suggestion: PI with existing sprints', () => {
  test('banner does not appear when the PI already has sprints configured', async ({ page }) => {
    const piName = `PI-2026.1-jira-import-existing-${RUN_ID}`;
    await putSprints(piName, [{ name: 'Sprint 1', capacity: 40 }]);
    await setPiSettings(piName, null);
    // No board-sprints mock: if the frontend fetched it, this would 404/error —
    // proving the banner-offer path never runs when sprints already exist.

    await openPiConfigPanel(page);

    await expect(page.locator('.pi-config-sprint-row')).toHaveCount(1);
    await expect(page.locator('#pi-config-jira-banner')).toBeEmpty();
  });
});
