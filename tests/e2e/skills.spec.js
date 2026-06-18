// ── E2E: Skills — command template editor workflow ────────────────────────────
import { test, expect } from '@playwright/test';

test.describe('Skills view', () => {
  test('navigates to Skills from sidebar and shows all 7 commands', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();
    await expect(page.locator('#skills-view')).toBeVisible();

    // Should have 7 skill cards (not counting product context)
    const skillCards = page.locator('.skill-card:not(.product-context-card)');
    await expect(skillCards).toHaveCount(7);

    // FAB should be hidden when not in backlog
    await expect(page.locator('#fab-container')).toBeHidden();
  });

  test('shows Product Context section at the top', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();
    await expect(page.locator('.product-context-card')).toBeVisible();
    await expect(page.locator('#skill-badge-product-context')).toContainText(/Template/i);
  });

  test('can expand a command card and see its content', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    // Click on the first skill card header to expand it
    const firstCard = page.locator('.skill-card:not(.product-context-card)').first();
    await firstCard.locator('.skill-header').click();

    // Textarea should now be visible
    const textarea = firstCard.locator('.skill-textarea');
    await expect(textarea).toBeVisible();
    // Should have content (the template)
    const value = await textarea.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('skill cards show Template badge by default', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    const badges = page.locator('.skill-card:not(.product-context-card) .skill-badge');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toContainText('Template');
    }
  });

  test('can save a command and badge changes to Custom', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    // Expand the create-epics card
    const card = page.locator('.skill-card[data-skill="create-epics"]');
    await card.locator('.skill-header').click();

    // Modify the textarea
    const textarea = card.locator('.skill-textarea');
    await textarea.fill(
      '---\nname: create-epics\ndescription: test\n---\n\nCustom content for E2E test'
    );

    // Save
    await card.locator('.btn-skill-save').click();

    // Badge should change to Custom
    await expect(card.locator('.skill-badge')).toContainText('Custom', { timeout: 5000 });

    // Status should show success
    await expect(card.locator('.skill-status')).toContainText('Saved');

    // Reset button should appear
    await expect(card.locator('.btn-skill-reset')).toBeVisible();
  });

  test('can reset a custom command back to Template', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    // The create-epics card should be Custom from the previous test
    const card = page.locator('.skill-card[data-skill="create-epics"]');
    await card.locator('.skill-header').click();

    // If it's still Template (tests may run in isolation), save first
    const badge = card.locator('.skill-badge');
    const badgeText = await badge.textContent();
    if (badgeText?.includes('Template')) {
      const textarea = card.locator('.skill-textarea');
      await textarea.fill('---\nname: create-epics\ndescription: test\n---\n\nCustom content');
      await card.locator('.btn-skill-save').click();
      await expect(badge).toContainText('Custom', { timeout: 5000 });
    }

    // Now reset
    await card.locator('.btn-skill-reset').click();

    // Badge should go back to Template
    await expect(badge).toContainText('Template', { timeout: 5000 });

    // Status should show reset message
    await expect(card.locator('.skill-status')).toContainText('Reset to template');
  });

  test('AI Improve button shows loading state', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    const card = page.locator('.skill-card[data-skill="create-stories"]');
    await card.locator('.skill-header').click();
    await expect(card.locator('.skill-textarea')).toBeVisible();

    const improveBtn = card.locator('.btn-skill-improve');
    await expect(improveBtn).toBeVisible();
    await expect(improveBtn).toHaveText('AI Improve');

    // Intercept the API call to avoid depending on real/mock AI
    await page.route('**/api/skills/create-stories/improve', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ improved: '---\nname: improved\n---\nImproved content' }),
      });
    });

    // Click improve
    await improveBtn.click();

    // Should show success status
    await expect(card.locator('.skill-status')).toContainText('AI suggestion applied', {
      timeout: 10000,
    });

    // Button should return to original text
    await expect(improveBtn).toHaveText('AI Improve');
  });

  test('can save and reset product context', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();

    // Expand product context
    const card = page.locator('.product-context-card');
    await card.locator('.skill-header').click();

    // Save custom content
    const textarea = card.locator('.skill-textarea');
    await textarea.fill('# My Product\n\nCustom context for testing.');
    await card.locator('.btn-skill-save').click();

    // Badge should change to Custom
    await expect(card.locator('.skill-badge')).toContainText('Custom', { timeout: 5000 });

    // Reset button should appear — click it
    await card.locator('.btn-skill-reset').click();
    await expect(card.locator('.skill-badge')).toContainText('Template', { timeout: 5000 });
  });

  test('Back button returns to Backlog view', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-item[data-view="skills"]').click();
    await expect(page.locator('#skills-view')).toBeVisible();

    // Click back
    await page.locator('#skills-view .btn-ghost').click();
    await expect(page.locator('#list-view')).toBeVisible();
    await expect(page.locator('#skills-view')).toBeHidden();

    // FAB should be visible again
    await expect(page.locator('#fab-container')).toBeVisible();
  });
});
