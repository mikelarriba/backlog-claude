// ── E2E: FAB bug creation in-panel flow (#367) ────────────────────────────
// Covers the in-panel bug sub-view introduced in #366, which replaced the
// standalone `#bug-modal-overlay` modal with a `#fab-view-bug` sub-view
// inside `#fab-panel`.
import { test, expect } from '@playwright/test';
import { clearDocsDir, rebuildServerIndex } from './fixtures.js';

test.beforeAll(async () => {
  clearDocsDir();
  await rebuildServerIndex();
});

async function openBugSubView(page) {
  await page.goto('/');
  await page.locator('#fab-btn').click();
  await page.locator('#fab-tab-create-btn').click();
  await page.locator('.btn-bug-create').click();
}

test.describe('FAB bug creation — navigation', () => {
  test('opens the bug sub-view inside the FAB panel, not a separate modal', async ({ page }) => {
    await openBugSubView(page);
    await expect(page.locator('#fab-view-bug')).toBeVisible();
    await expect(page.locator('#fab-view-main')).toBeHidden();
    await expect(page.locator('#bug-modal-overlay')).toHaveCount(0);
  });

  test('bug sub-view header shows a "← Bug Report" back button', async ({ page }) => {
    await openBugSubView(page);
    await expect(page.locator('.fab-back-btn')).toContainText('Bug Report');
  });

  test('back button returns to the Create/Import tab view', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('.fab-back-btn').click();
    await expect(page.locator('#fab-view-main')).toBeVisible();
    await expect(page.locator('.fab-tab-bar')).toBeVisible();
    await expect(page.locator('#fab-view-bug')).toBeHidden();
  });

  test('FAB close button dismisses the panel from the main view', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fab-btn').click();
    await expect(page.locator('#fab-panel')).toHaveClass(/open/);
    await page.locator('#fab-view-main .fab-panel-header .btn-ghost').click();
    await expect(page.locator('#fab-panel')).not.toHaveClass(/open/);
  });

  test('FAB close button dismisses the panel from the bug sub-view', async ({ page }) => {
    await openBugSubView(page);
    await expect(page.locator('#fab-panel')).toHaveClass(/open/);
    await page.locator('#fab-view-bug .fab-back-bar .btn-ghost:not(.fab-back-btn)').click();
    await expect(page.locator('#fab-panel')).not.toHaveClass(/open/);
  });

  test('only one popup is visible at a time — no stacked overlays', async ({ page }) => {
    await openBugSubView(page);
    await expect(page.locator('.dialog-overlay.show')).toHaveCount(0);
    const mainVisible = await page.locator('#fab-view-main').isVisible();
    const bugVisible = await page.locator('#fab-view-bug').isVisible();
    expect(mainVisible).toBe(false);
    expect(bugVisible).toBe(true);
  });
});

test.describe('FAB bug creation — validation', () => {
  test('submitting with ID empty shows an inline error and stays on the form', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('#bug-title').fill('Missing ID bug');
    await page.locator('#bug-submit-btn').click();
    await expect(page.locator('#bug-status')).toContainText(/required/i, { timeout: 3000 });
    await expect(page.locator('#fab-view-bug')).toBeVisible();
  });

  test('submitting with Title empty shows an inline error and stays on the form', async ({
    page,
  }) => {
    await openBugSubView(page);
    await page.locator('#bug-id').fill('SC3-1111');
    await page.locator('#bug-submit-btn').click();
    await expect(page.locator('#bug-status')).toContainText(/required/i, { timeout: 3000 });
    await expect(page.locator('#fab-view-bug')).toBeVisible();
  });

  test('submitting with both ID and Title sends a request to /api/bugs/create', async ({
    page,
  }) => {
    await openBugSubView(page);
    await page.locator('#bug-id').fill('SC3-2222');
    await page.locator('#bug-title').fill('Valid bug submission');

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes('/api/bugs/create') && req.method() === 'POST'
      ),
      page.locator('#bug-submit-btn').click(),
    ]);
    expect(request).toBeTruthy();
  });
});

test.describe('FAB bug creation — successful submission', () => {
  test('valid submit shows a success toast and returns to the main FAB view', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('#bug-id').fill('SC3-3333');
    await page.locator('#bug-title').fill('Toast E2E Bug');
    await page.locator('#bug-submit-btn').click();

    await expect(page.locator('#jira-push-toast')).toHaveClass(/success/, { timeout: 10000 });
    await expect(page.locator('#jira-push-toast')).toContainText('Bug created');
    await expect(page.locator('#fab-view-main')).toBeVisible();
    await expect(page.locator('#fab-view-bug')).toBeHidden();
  });

  test('newly created bug appears in the backlog list', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('#bug-id').fill('SC3-4444');
    await page.locator('#bug-title').fill('Backlog Visible Bug');

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/bugs/create') && res.request().method() === 'POST'
      ),
      page.locator('#bug-submit-btn').click(),
    ]);
    const { filename } = await response.json();

    await expect(page.locator('#detail-view')).toBeVisible({ timeout: 10000 });
    await page.locator('#detail-view .btn-ghost').first().click();
    await expect(page.locator(`#epic-list [data-filename="${filename}"]`)).toBeVisible();
  });
});

test.describe('FAB bug creation — file attachments', () => {
  test('the file drop zone is visible inside the panel', async ({ page }) => {
    await openBugSubView(page);
    await expect(page.locator('#bug-dropzone')).toBeVisible();
  });

  test('attaching 1 valid file shows its name in the file list', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('#bug-files').setInputFiles({
      name: 'screenshot.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-png-content'),
    });
    await expect(page.locator('.bug-file-item')).toHaveCount(1);
    await expect(page.locator('.bug-file-name')).toHaveAttribute('title', 'screenshot.png');
  });

  test('attaching more than 5 files rejects the excess', async ({ page }) => {
    await openBugSubView(page);
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `file-${i}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(`content ${i}`),
    }));
    await page.locator('#bug-files').setInputFiles(files);
    // Only the first 5 are kept — the 6th is silently dropped by addBugFiles().
    await expect(page.locator('.bug-file-item')).toHaveCount(5);
    await expect(page.locator('#bug-dropzone-label')).toContainText('5/5');
  });

  test('remove file button removes a file from the list', async ({ page }) => {
    await openBugSubView(page);
    await page.locator('#bug-files').setInputFiles({
      name: 'to-remove.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('content'),
    });
    await expect(page.locator('.bug-file-item')).toHaveCount(1);
    await page.locator('.bug-file-remove').click();
    await expect(page.locator('.bug-file-item')).toHaveCount(0);
  });
});

test.describe('FAB bug creation — regression guard', () => {
  test('#bug-modal-overlay no longer exists in the DOM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#bug-modal-overlay')).toHaveCount(0);
  });

  test('openBugModal is no longer a callable global function', async ({ page }) => {
    await page.goto('/');
    const type = await page.evaluate(() => typeof window.openBugModal);
    expect(type).toBe('undefined');
  });

  test('closeBugModal is no longer a callable global function', async ({ page }) => {
    await page.goto('/');
    const type = await page.evaluate(() => typeof window.closeBugModal);
    expect(type).toBe('undefined');
  });
});
