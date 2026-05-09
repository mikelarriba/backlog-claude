// ── E2E: Create — draft form creates a new document ──────────────────────────
import { test, expect } from '@playwright/test';
import { clearDocsDir } from './fixtures.js';

test.beforeAll(() => {
  clearDocsDir();
});

test.describe('Create — Save Draft form', () => {
  test('page loads and shows the list view', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#list-view')).toBeVisible();
  });

  test('can fill the title field', async ({ page }) => {
    await page.goto('/');
    await page.locator('#doc-title').fill('My E2E Draft Epic');
    await expect(page.locator('#doc-title')).toHaveValue('My E2E Draft Epic');
  });

  test('type selector has all expected options', async ({ page }) => {
    await page.goto('/');
    const options = await page.locator('#doc-type option').allTextContents();
    expect(options).toContain('Epic');
    expect(options).toContain('Story');
    expect(options).toContain('Spike');
    expect(options).toContain('New Feature');
    expect(options).toContain('Bug');
  });

  test('saving a draft with title creates the document', async ({ page }) => {
    await page.goto('/');
    await page.locator('#doc-title').fill('Playwright Draft Story');
    await page.locator('#doc-type').selectOption('story');
    await page.locator('#draft-btn').click();

    // Wait for the detail view to open (the doc was created)
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 10000 });
  });

  test('created document appears in the list', async ({ page }) => {
    await page.goto('/');
    await page.locator('#doc-title').fill('List Visible Draft');
    await page.locator('#doc-type').selectOption('epic');
    await page.locator('#draft-btn').click();

    // Navigate back to list
    await page.locator('#detail-view .btn-ghost').first().click();
    await expect(page.locator('#epic-list')).toContainText('List Visible Draft');
  });

  test('requires a title to save a draft', async ({ page }) => {
    await page.goto('/');
    // Leave title empty
    await page.locator('#doc-type').selectOption('story');
    await page.locator('#draft-btn').click();

    // Should show error status, not open detail view
    await expect(page.locator('#status')).toContainText('required', { timeout: 3000 });
  });
});
