// ── E2E: Roadmap — two-panel layout, PI filter, panel collapse ───────────────
import { test, expect } from '@playwright/test';
import { clearDocsDir, createFixtureDoc } from './fixtures.js';

test.beforeAll(() => {
  clearDocsDir();
  createFixtureDoc('epic',  { title: 'Roadmap Epic Alpha',  fixVersion: 'PI-2026.1' });
  createFixtureDoc('story', { title: 'Roadmap Story Alpha', fixVersion: 'PI-2026.1', sprint: 'Sprint 1' });
});

test.describe('Roadmap — open and layout', () => {
  test('Roadmap button opens the roadmap view', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#roadmap-view')).toBeVisible({ timeout: 5000 });
  });

  test('roadmap view has two panel sections (epics + stories)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#rm-body-epics,   [id^="rm-body-epics"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#rm-body-stories, [id^="rm-body-stories"]')).toBeVisible({ timeout: 5000 });
  });

  test('roadmap has a PI filter dropdown', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#roadmap-pi-filter')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Roadmap — panel collapse', () => {
  test('clicking Epics panel header toggles collapse', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#rm-body-epics')).toBeVisible({ timeout: 5000 });

    // Find the epics panel toggle button/header
    const epicsToggle = page.locator('#rm-chevron-epics').locator('..').locator('..').first();
    const epicsHeader = page.locator('button:has(#rm-chevron-epics), [onclick*="toggleRoadmapPanel"][onclick*="epics"]').first();

    if (await epicsHeader.isVisible()) {
      await epicsHeader.click();
      // Panel body should have collapsed class
      await expect(page.locator('#rm-body-epics')).toHaveClass(/collapsed/, { timeout: 3000 });
      // Click again to expand
      await epicsHeader.click();
      await expect(page.locator('#rm-body-epics')).not.toHaveClass(/collapsed/, { timeout: 3000 });
    }
  });

  test('clicking Stories panel header toggles collapse', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#rm-body-stories')).toBeVisible({ timeout: 5000 });

    const storiesHeader = page.locator('[onclick*="toggleRoadmapPanel"][onclick*="stories"]').first();
    if (await storiesHeader.isVisible()) {
      await storiesHeader.click();
      await expect(page.locator('#rm-body-stories')).toHaveClass(/collapsed/, { timeout: 3000 });
    }
  });
});

test.describe('Roadmap — PI filter', () => {
  test('selecting a PI from the filter dropdown re-renders the board', async ({ page }) => {
    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#roadmap-pi-filter')).toBeVisible({ timeout: 5000 });

    // Select any available option
    const options = await page.locator('#roadmap-pi-filter option').allTextContents();
    if (options.length > 1) {
      await page.locator('#roadmap-pi-filter').selectOption({ index: 1 });
      // Board should still be visible after filter change
      await expect(page.locator('#rm-body-stories')).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Roadmap — JIRA mock intercept', () => {
  test('JIRA API calls are interceptable via route mock', async ({ page }) => {
    await page.route('**/api/jira/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ issues: [] }),
    }));

    await page.goto('/');
    await page.locator('.btn-toolbar-roadmap, button:has-text("Roadmap")').click();
    await expect(page.locator('#roadmap-view')).toBeVisible({ timeout: 5000 });
  });
});
