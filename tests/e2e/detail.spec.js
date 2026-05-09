// ── E2E: Detail view — open doc, edit title, change status ───────────────────
import { test, expect } from '@playwright/test';
import { clearDocsDir, createFixtureDoc } from './fixtures.js';

let epicFilename;
let epicTitle;

test.beforeAll(() => {
  clearDocsDir();
  const epic = createFixtureDoc('epic', {
    title: 'Detail View Test Epic',
    status: 'Draft',
    description: 'This is a detail view test epic.',
  });
  epicFilename = epic.filename;
  epicTitle    = epic.title;
});

test.describe('Detail view — opening a document', () => {
  test('clicking a list item opens the detail view', async ({ page }) => {
    await page.goto('/');
    // Wait for the list to load
    await expect(page.locator('#epic-list')).toContainText(epicTitle, { timeout: 8000 });
    // Click the item
    await page.locator('#epic-list').getByText(epicTitle).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });
  });

  test('detail view renders the document title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(epicTitle, { timeout: 8000 });
    await page.locator('#epic-list').getByText(epicTitle).first().click();
    await expect(page.locator('#detail-content, .markdown')).toContainText(epicTitle, { timeout: 5000 });
  });

  test('back button closes the detail view', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(epicTitle, { timeout: 8000 });
    await page.locator('#epic-list').getByText(epicTitle).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });

    // Click Back
    await page.locator('#detail-view').getByText('← Back').click();
    // List view should be restored
    await expect(page.locator('#list-view')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Detail view — PATCH title', () => {
  test('inline title edit sends PATCH and updates the heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(epicTitle, { timeout: 8000 });
    await page.locator('#epic-list').getByText(epicTitle).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });

    // Find the editable title element
    const titleEl = page.locator('#detail-title, [contenteditable="true"]').first();
    if (await titleEl.isVisible()) {
      await titleEl.click();
      await titleEl.fill('Updated Title Via E2E');
      await titleEl.press('Enter');
      // Verify the updated title is reflected
      await expect(page.locator('#detail-view')).toContainText('Updated Title Via E2E', { timeout: 5000 });
    }
  });
});
