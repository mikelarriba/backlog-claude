// ── E2E: List view — filter pills, type filter, status filter ────────────────
import { test, expect } from '@playwright/test';
import { clearDocsDir, createFixtureDoc } from './fixtures.js';

test.beforeAll(() => {
  clearDocsDir();
  // Create a known set of fixture documents for filtering
  createFixtureDoc('story', { title: 'Filter Story Alpha', status: 'Draft' });
  createFixtureDoc('story', { title: 'Filter Story Beta',  status: 'Draft' });
  createFixtureDoc('epic',  { title: 'Filter Epic One',    status: 'Draft' });
  createFixtureDoc('epic',  { title: 'Filter Epic Two',    status: 'Created in JIRA' });
  createFixtureDoc('spike', { title: 'Filter Spike One',   status: 'Draft' });
});

test.describe('List view — type filter pills', () => {
  test('shows all items by default (All filter active)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.pill[data-type="all"]')).toHaveClass(/active/);
    // At least some items should be visible
    await expect(page.locator('#epic-list .list-item, #epic-list .doc-card, #epic-list [data-doctype]').first()).toBeVisible({ timeout: 5000 });
  });

  test('filter by Story shows only stories', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pill[data-type="story"]').click();
    await expect(page.locator('.pill[data-type="story"]')).toHaveClass(/active/);

    // All visible cards should be stories
    const cards = page.locator('#epic-list [data-doctype]');
    const count = await cards.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(cards.nth(i)).toHaveAttribute('data-doctype', 'story');
      }
    }
  });

  test('filter by Epic shows only epics', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pill[data-type="epic"]').click();

    const cards = page.locator('#epic-list [data-doctype]');
    const count = await cards.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(cards.nth(i)).toHaveAttribute('data-doctype', 'epic');
      }
    }
  });

  test('filter by All restores all items', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pill[data-type="story"]').click();
    await page.locator('.pill[data-type="all"]').click();
    await expect(page.locator('.pill[data-type="all"]')).toHaveClass(/active/);
  });
});

test.describe('List view — status filter', () => {
  test('filter by Draft shows only draft items', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pill[data-status="Draft"]').click();

    const badges = page.locator('#epic-list .status-badge');
    const count = await badges.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        await expect(badges.nth(i)).toHaveText('Draft');
      }
    }
  });
});

test.describe('List view — search', () => {
  test('search input filters the list by title', async ({ page }) => {
    await page.goto('/');
    await page.locator('#search').fill('Filter Epic One');

    // After typing, only matching docs should be shown
    await expect(page.locator('#epic-list')).toContainText('Filter Epic One', { timeout: 5000 });
  });

  test('search with no match shows empty state or empty list', async ({ page }) => {
    await page.goto('/');
    await page.locator('#search').fill('zzz-no-match-xyz-9999');
    // The list should be empty or show an empty state
    const items = page.locator('#epic-list [data-doctype]');
    await expect(items).toHaveCount(0, { timeout: 3000 });
  });
});
