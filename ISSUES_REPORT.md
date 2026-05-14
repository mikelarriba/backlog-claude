# GitHub Issues Resolution Report
**Date:** 2026-05-14  
**Repository:** mikelarriba/backlog-claude  
**Processed by:** Claude Code

---

## Session 2026-05-14 — Issues Fixed This Session

| # | Title | Type | PR | Status |
|---|-------|------|----|--------|
| 59 | Enlarge JIRA sync preview and selection popups | Enhancement | #62 | ✅ Merged |
| 60 | Collapse/Expand All buttons should only affect features and epics | Enhancement | #63 | ✅ Merged |
| 61 | Check JIRA shows all items as changed (missing description field) | Bug | #64 | ✅ Merged |

**Skipped (on-hold label):** #50, #51, #52, #53 — TypeScript migration phases.

### Test Results After Session

```
# tests 189   (+5 new)
# pass  189
# fail    0
```

---

### Issue #59 — Enlarge JIRA sync preview and selection popups

**PR #62** | File: `public/css/jira.css` | ✅ Merged

- `.jira-select-dialog`: `540px` → `700px`, `max-width` `90vw` → `94vw`
- `.jira-select-list`: `max-height` `340px` → `60vh`
- Added `.sync-preview-dialog` (`800px`, `94vw`) and `.sync-preview-list` (`60vh`) for the check-all preview

---

### Issue #60 — Collapse/Expand All buttons should only affect features/epics

**PR #63** | Files: `public/js/list.js`, `index.html` | ✅ Merged

- `collapseAll()`: adds all feature/epic filenames that have children to `_collapsedItems`; never touches `_swimlanesCollapsed`
- `expandAll()`: clears `_collapsedItems`; PI swimlanes stay open
- Added **⊟ Collapse** and **⊞ Expand** buttons to the list header

---

### Issue #61 — Check JIRA shows all items as changed (missing description field)

**PR #64** | Files: `src/routes/jira-sync.js`, `tests/integration/jira-check-all.test.js` | ✅ Merged

- Implemented `POST /api/jira/check-all` — fields query includes `description` from the start; without it `iss.fields?.description` is `undefined` → empty string causing every item with a local description to appear as "changed"
- `_scanLinkedDocs()`: scans doc directories directly (not the in-memory index) for reliability
- `_buildPreviewItem()`: compares summary, status, story-points, and description
- Response: `{ changed[], skipped[], errors[], total }`
- 5 new integration tests including the no-false-positive description test

---

## Problems Faced (2026-05-14)

1. **Push rejection on first branch**: local branch was based on stale `origin/main` ref. Fixed with `git rebase origin/<branch>` before pushing.
2. **DocIndex not seeded in tests**: `check-all` initially used `docIndex.getAll()` (in-memory, built at startup). Test files written directly to disk were invisible. Resolved by implementing `_scanLinkedDocs()` which reads from disk directly — correct for an admin operation.
3. **`npm install` needed**: first test run failed with `Cannot find package 'express'`. Installed once; all subsequent runs passed.

---

## Previous Session (2026-05-09)

All 4 open issues resolved, each with a dedicated branch, PR, and squash-merge to `main`. The test suite grew from 174 to 184 passing tests with zero failures.

### Issues Fixed

### Issue #30 — feat: sync JIRA description and title
**PR #38** | Branch: `issue/30-jira-sync-description` | Status: ✅ Merged

- `src/routes/jira-sync.js`: Extended `POST /api/jira/sync-status` to fetch `summary` + `description` from JIRA in addition to status/story-points. Now updates the `## Title` heading when the JIRA summary differs from local, replaces the description body when it has changed, and appends a `JIRA Description Update` history entry to `INBOX_DIR/<filename>`. The `POST /api/jira/update-from-jira` endpoint also detects description changes before overwriting and writes the same history format.

**New tests:** `tests/integration/jira-sync-description.test.js` (7 tests)

---

### Issue #32 — feat: ghost duplicate cards in roadmap for stories split across PIs
**PR #39** | Branch: `issue/32-ghost-cards-roadmap` | Status: ✅ Merged

- `public/js/roadmap.js`: Added `injectGhostCards()` for cross-PI split stories
- `public/css/roadmap.css`: Ghost card styles (dashed border, 50% opacity)

---

### Issue #33 — feat: story dependencies — left/right ordering enforces sequential sprints
**PR #40** | Branch: `issue/33-story-dependencies` | Status: ✅ Merged

- `src/services/docIndex.js`, `src/routes/links.js`, `src/routes/docs-batch.js`: blocks/blockedBy frontmatter, BFS cycle detection, apply-distribution sprint adjustment
- `public/js/roadmap.js`, `public/css/roadmap.css`: dependency badges

**New tests:** `tests/integration/dependencies.test.js` (10 tests)

---

### Issue #34 — feat: UI testing setup with Playwright
**PR #41** | Branch: `issue/34-playwright-e2e` | Status: ✅ Merged

- `playwright.config.js`, `tests/e2e/` (4 spec files, 20 tests)
- **To run:** `npx playwright install && npm run test:e2e`
