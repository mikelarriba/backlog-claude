// ── E2E: Detail view — open doc, edit title, change status ───────────────────
import { test, expect } from '@playwright/test';
import { clearDocsDir, createFixtureDoc, rebuildServerIndex } from './fixtures.js';

let _epicFilename;
let epicTitle;

test.beforeAll(async () => {
  clearDocsDir();
  const epic = createFixtureDoc('epic', {
    title: 'Detail View Test Epic',
    status: 'Draft',
    description: 'This is a detail view test epic.',
  });
  _epicFilename = epic.filename;
  epicTitle = epic.title;
  await rebuildServerIndex();
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
    await expect(page.locator('#detail-content, .markdown')).toContainText(epicTitle, {
      timeout: 5000,
    });
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
      await expect(page.locator('#detail-view')).toContainText('Updated Title Via E2E', {
        timeout: 5000,
      });
    }
  });
});

test.describe('Detail view — remove dependency chip (#461 typed action-dispatch)', () => {
  test("clicking a dep chip's remove button (data-action) deletes the link", async ({ page }) => {
    const source = createFixtureDoc('epic', { title: `Dep Source Epic ${Date.now()}` });
    const target = createFixtureDoc('epic', { title: `Dep Target Epic ${Date.now()}` });
    await rebuildServerIndex();

    const linkRes = await fetch('http://localhost:3000/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'epic',
        sourceFilename: source.filename,
        targetType: 'epic',
        targetFilename: target.filename,
        linkType: 'blocks',
      }),
    });
    if (!linkRes.ok) throw new Error(`create link failed: ${linkRes.status}`);

    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(source.title, { timeout: 8000 });
    await page.locator('#epic-list').getByText(source.title).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });

    const chip = page.locator('.dep-chip', { hasText: target.title });
    await expect(chip).toBeVisible({ timeout: 5000 });

    // The remove button is only shown on hover (see .dep-chip:hover
    // .dep-chip-delete in detail.css), so hover the chip before clicking it.
    await chip.hover();
    await chip.locator('.dep-chip-delete').click();

    await expect(page.locator('.dep-chip', { hasText: target.title })).toHaveCount(0);
  });
});

test.describe('Detail view — hierarchy panel (#461 typed action-dispatch)', () => {
  test('clicking a hierarchy child header (data-action) expands it and loads its content', async ({
    page,
  }) => {
    const epic = createFixtureDoc('epic', { title: `Hierarchy Epic ${Date.now()}` });
    const story = createFixtureDoc('story', {
      title: `Hierarchy Child Story ${Date.now()}`,
      description: 'Child story body content.',
    });
    await rebuildServerIndex();

    const linkRes = await fetch('http://localhost:3000/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'story',
        sourceFilename: story.filename,
        targetType: 'epic',
        targetFilename: epic.filename,
      }),
    });
    if (!linkRes.ok) throw new Error(`create link failed: ${linkRes.status}`);

    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(epic.title, { timeout: 8000 });
    await page.locator('#epic-list').getByText(epic.title).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });

    const childRow = page.locator('.hierarchy-child', { hasText: story.title });
    await expect(childRow).toBeVisible({ timeout: 5000 });
    await expect(childRow).not.toHaveClass(/open/);

    await childRow.locator('.hierarchy-child-header').click();

    await expect(childRow).toHaveClass(/open/);
    await expect(childRow.locator('.hierarchy-child-body')).toContainText(
      'Child story body content',
      { timeout: 5000 }
    );

    // Clicking again (data-action toggles via the same handler) collapses it.
    await childRow.locator('.hierarchy-child-header').click();
    await expect(childRow).not.toHaveClass(/open/);
  });

  test('the "Link existing" button (data-action) opens the select modal and links an item', async ({
    page,
  }) => {
    const epic = createFixtureDoc('epic', { title: `Link Existing Epic ${Date.now()}` });
    const story = createFixtureDoc('story', { title: `Linkable Story ${Date.now()}` });
    await rebuildServerIndex();

    await page.goto('/');
    await expect(page.locator('#epic-list')).toContainText(epic.title, { timeout: 8000 });
    await page.locator('#epic-list').getByText(epic.title).first().click();
    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });

    const linkBtn = page.locator('.btn-link-existing');
    await expect(linkBtn).toBeVisible({ timeout: 5000 });
    await linkBtn.click();

    const modal = page.locator('#jira-select-overlay');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const item = page.locator('.jira-select-item', { hasText: story.title });
    await expect(item).toBeVisible({ timeout: 5000 });

    await page.locator('#jira-select-confirm-btn').click();

    await expect(page.locator('.hierarchy-child', { hasText: story.title })).toBeVisible({
      timeout: 5000,
    });
  });
});
