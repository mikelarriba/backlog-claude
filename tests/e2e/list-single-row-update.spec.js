// ── E2E: List view — single-doc edits patch only the changed row (#457) ──────
// Editing one story's points (or any non-structural field) should not tear
// down and rebuild the whole swimlane tree — verified by tagging every row's
// DOM node with a JS marker before the edit and confirming unrelated rows
// keep their marker afterward (a full innerHTML rebuild would destroy it).
import { test, expect } from '@playwright/test';
import { clearDocsDir, createFixtureDoc, rebuildServerIndex } from './fixtures.js';

let storyA, storyB, storyC;

test.beforeAll(async () => {
  clearDocsDir();
  storyA = createFixtureDoc('story', { title: 'Row Patch Story A', storyPoints: '3' });
  storyB = createFixtureDoc('story', { title: 'Row Patch Story B', storyPoints: '5' });
  storyC = createFixtureDoc('story', { title: 'Row Patch Story C', storyPoints: '2' });
  await rebuildServerIndex();
});

test("editing one story's points patches only that row, leaving sibling row DOM nodes untouched", async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#epic-list')).toContainText(storyA.title, { timeout: 8000 });
  await expect(page.locator('#epic-list')).toContainText(storyB.title, { timeout: 8000 });
  await expect(page.locator('#epic-list')).toContainText(storyC.title, { timeout: 8000 });

  // Tag every currently-rendered row with a JS property (not an HTML
  // attribute) — a full `list.innerHTML = html` rebuild discards the node
  // entirely, so only a row that survives in place keeps this marker.
  await page.evaluate(() => {
    document.querySelectorAll('#epic-list .epic-item[data-filename]').forEach((el) => {
      el.__rowMarker = true;
    });
  });

  // Open story A's detail view and edit its story points via the real UI
  // path (detail-fields.ts's saveStoryPoints() -> upsertDoc()).
  await page.locator('#epic-list').getByText(storyA.title).first().click();
  await expect(page.locator('#detail-view')).toBeVisible({ timeout: 5000 });
  const spInput = page.locator('#sp-input');
  await spInput.fill('8');
  await spInput.blur();

  // The edited row reflects the new value...
  await expect(
    page.locator(`#epic-list .epic-item[data-filename="${storyA.filename}"]`)
  ).toContainText('8 SP', { timeout: 5000 });

  // ...while sibling rows were never torn down and recreated.
  const survived = await page.evaluate(
    ({ bFile, cFile }) => {
      const bEl = document.querySelector(`#epic-list .epic-item[data-filename="${bFile}"]`);
      const cEl = document.querySelector(`#epic-list .epic-item[data-filename="${cFile}"]`);
      return { b: !!bEl?.__rowMarker, c: !!cEl?.__rowMarker };
    },
    { bFile: storyB.filename, cFile: storyC.filename }
  );
  expect(survived.b).toBe(true);
  expect(survived.c).toBe(true);
});
