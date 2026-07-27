# Backlog Claude

[![CI](https://github.com/mikelarriba/backlog-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/mikelarriba/backlog-claude/actions/workflows/ci.yml)

A full-stack PWA + AI Product Owner agent that transforms rough ideas into sprint-ready Epics, Stories, Spikes, and Features using the **COVE Framework** and **Claude AI**.

---

## How it works

```
Browser (PWA)
   │  POST /api/generate  (idea + type)
   ▼
Express Server
   │  Calls Claude CLI to generate the document
   ▼
docs/epics|stories|spikes|features/*.md   ← structured COVE doc saved to disk
   │
   ├─ Broadcast SSE → all open tabs refresh automatically
   ├─ JIRA push  (POST /api/jira/push/:type/:filename)  → creates/updates issue
   └─ JIRA pull  (POST /api/jira/pull)                  → imports issue as local .md
```

For docs dropped directly into `/inbox/`, `fs.watch` detects them and auto-processes them via Claude (same pipeline, no browser needed).

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in JIRA_BASE_URL, JIRA_API_TOKEN, JIRA_PROJECT, JIRA_LABEL

# 3. Start the server
npm start          # tsx --watch server.ts  (auto-restarts on file changes)

# 4. Open the app
open http://localhost:3000
```

---

## Docker

```bash
# Start with Docker Compose
docker compose up

# Or build and run manually
docker build -t backlog-claude .
docker run -p 3000:3000 --env-file .env \
  -v ./docs:/app/docs \
  -v ./inbox:/app/inbox \
  backlog-claude
```

The `docs/` and `inbox/` directories are volume-mounted so data persists across container restarts. Set environment variables via `.env` (copy from `.env.example`).

Health check: `GET /api/health` returns `{ status: "ok", uptime, docsDir, version }`.

---

## Environment variables

| Variable         | Required   | Description                                                   |
| :--------------- | :--------- | :------------------------------------------------------------ |
| `JIRA_BASE_URL`  | For JIRA   | e.g. `https://your-org.atlassian.net/jira`                    |
| `JIRA_API_TOKEN` | For JIRA   | Personal Access Token — all JIRA routes return 503 if unset   |
| `JIRA_PROJECT`   | For JIRA   | Project key (e.g. `MID`)                                      |
| `JIRA_LABEL`     | For JIRA   | Label applied to every created issue                          |
| `PORT`           | No         | HTTP port (default: `3000`)                                   |
| `MOCK_CLAUDE`    | Tests only | Set to `1` to skip the Claude subprocess in integration tests |

---

## Features

### Document management

- **AI generation** — describe a rough idea; Claude writes a full COVE-structured document
- **Upgrade** — regenerate any document with inline feedback via a streaming SSE response
- **Draft** — save a document without AI (instant, no Claude call)
- **Edit in place** — rename, change status, fix-version, story points, sprint, and rank all via PATCH
- **Delete / batch delete** — single or multi-select deletion

### List view

- **Three swimlanes** — Current PI · Next PI · Backlog; drag a card to a different swimlane to reassign its fix-version
- **Hierarchy tree** — Feature → Epic → Story / Spike / Bug displayed with indent and collapse/expand
- **Rank ordering** — drag the 6-dot handle up or down within a swimlane; a blue insertion line shows the drop position; order is persisted as a `Rank` field in each file's frontmatter
- **Story dependencies** — hover any leaf item (story / spike / bug) and click ⛓ to open the dependency modal; mark which stories this one must precede; blocked items display a red `🔒 N` badge and are visually indented further right to signal sequential ordering; blocking items display a green `→ N` badge
- **Readiness traffic light** — green / amber / red dot per item based on story-point coverage and description completeness
- **Filters** — filter by type and status; live search by title or filename
- **Multi-select** — Shift-click or context menu to select multiple items for batch operations

### JIRA integration

- **Push** — converts the local `.md` to JIRA wiki markup and creates or updates the issue; writes `JIRA_ID` and `JIRA_URL` back to the file
- **Pull** — imports a JIRA issue (by key or search) as a local `.md` file
- **Sync status** — fetches current JIRA status, story points, and fix-version and merges them into the local file
- **Rank sync** — `POST /api/jira/push-rank` reorders issues in the JIRA backlog to match local rank
- **Search** — keyword search within the configured project
- **Versions** — fetches active fix-versions from JIRA for the version selector
- **Children** — fetches epic children from JIRA and imports them as local files
- **Attachments** — bug files with a matching `docs/bugs/attachments/<slug>/` directory have their attachments uploaded to the JIRA issue on push

### Roadmap view

- **Two-panel board** — Epic timeline (Gantt-style sprint spans) + Story columns per sprint
- **PI filter** — show all sprints, or filter to Current PI / Next PI
- **Dependency indicators** — story cards show `→ N` (blocks) and `🔒 N` (blocked) badges
- **Drag sprint assignment** — drag story cards between sprint columns; persisted immediately
- **Story split** — split a large story into two smaller ones across two sprints using Claude AI

### Sprint distribution

- **Auto-distribute** — greedy fill of stories into sprints by priority rank and story points
- **Dependency ordering warnings** — if a blocker is assigned to the same or a later sprint than its blocked story, the apply step returns warnings
- **Preview + apply** — review the proposed assignment before committing

### PI & sprint configuration

- **Current / Next PI** — set the active fix-version names
- **Sprint config** — define sprint names and capacity (SP) per PI
- **Split threshold** — configure when the story-split AI suggestion triggers

### Bugs

- **Bug reporter** — paste HTML or plain text; Claude translates it to a structured bug report
- **Attachment upload** — attach screenshots / MSG files at creation time; uploaded to JIRA on push

### Inbox auto-processing

Any `.md` file dropped into `/inbox/` is picked up by `fs.watch`:

1. Claude CLI generates the polished document from the raw idea
2. The document is saved to the appropriate `docs/` subfolder
3. All open browser tabs refresh via SSE

---

## COVE Framework

Every generated document follows this structure:

| Component         | Description                                         |
| :---------------- | :-------------------------------------------------- |
| **C — Context**   | Why are we building this now?                       |
| **O — Objective** | The specific, measurable goal of this ticket        |
| **V — Value**     | The "So What?" — benefit to users or the business   |
| **E — Execution** | High-level technical steps (always states V1 or V2) |

---

## Document types

| Type        | Description                                      | Directory        |
| :---------- | :----------------------------------------------- | :--------------- |
| **Feature** | High-level strategic capability grouping         | `docs/features/` |
| **Epic**    | Scoped body of work within a Feature (one PI)    | `docs/epics/`    |
| **Story**   | Sprint-sized user-facing requirement             | `docs/stories/`  |
| **Spike**   | Time-boxed technical research task               | `docs/spikes/`   |
| **Bug**     | Defect report with structured reproduction steps | `docs/bugs/`     |

Hierarchy: `Feature → Epic → Story / Spike / Bug`

Links are stored as `Feature_ID` / `Epic_ID` fields in YAML frontmatter. Story dependencies are stored as `Blocks` / `Blocked_By` comma-separated filename lists.

---

## Frontmatter reference

Every document starts with a YAML frontmatter block:

```yaml
---
JIRA_ID: MID-1234 # TBD until pushed to JIRA
JIRA_URL: https://... # written automatically on push
Story_Points: 5 # TBD until estimated
Status: Draft # Draft | Created in JIRA | Archived
Priority: High # Critical | Major | High | Medium | Low
Fix_Version: PI-2026-Q2 # matches a configured PI name
Squad: TBD
PI: TBD
Sprint: Sprint-3 # assigned manually or via distribution
Rank: 4 # integer; controls list order within type
Created: 2026-05-08
Epic_ID: 2026-04-01-my-epic.md # for stories/spikes/bugs
Feature_ID: 2026-03-01-my-feature.md # for epics
Blocks: 2026-05-02-story-b.md # comma-separated; this story must come first
Blocked_By: 2026-04-30-story-a.md # comma-separated; this story must come after
---
```

---

## Project structure

The backend is TypeScript, compiled/run on the fly via `tsx` (no separate build step for the server). The frontend is also authored in TypeScript under `public/ts/`, but the browser loads the compiled output committed to `public/js/` — run `npm run build:frontend` after editing anything in `public/ts/` (see "Adding a new frontend module" in `CONTRIBUTING.md`).

```
backlog-claude/
├── server.ts                      # Entry point: mounts routes, SSE, static files
├── index.html                     # App shell
│
├── src/
│   ├── app/
│   │   ├── context.ts             # DI container — wires shared deps into route modules
│   │   ├── middleware.ts          # Global Express middleware (CORS, rate limiting, …)
│   │   └── routes.ts              # Registers every route module on the Express app
│   │
│   ├── config/
│   │   ├── docTypes.ts            # Single source of truth for doc types (Epic/Story/Spike/Bug/…)
│   │   ├── env.ts                 # Environment variable loading/validation
│   │   ├── metadata.ts            # Teams, work categories, JIRA label mappings
│   │   └── openapi.ts, openapi/   # buildOpenApiSpec() — generates the /api-docs spec from zod schemas
│   │
│   ├── routes/                    # One file per resource; thin (parse → call service → shape response)
│   │   ├── docs-crud.ts           # GET /api/docs, GET|PATCH|DELETE /api/doc, POST /api/docs/draft
│   │   ├── docs-ai.ts             # POST /api/generate, /upgrade, /split-story (SSE streaming)
│   │   ├── docs-batch.ts          # POST /api/docs/batch-delete, /batch-fix-version,
│   │   │                          #      /distribute, /apply-distribution, /rerank
│   │   ├── jira-push-doc.ts       # POST /api/jira/push/:type/:filename, /push-preview
│   │   ├── jira-push-rank.ts      # POST /api/jira/push-rank
│   │   ├── jira-push-sprints.ts   # POST /api/jira/push-sprints
│   │   ├── jira-sync.ts           # POST /api/jira/sync-status, /update-from-jira, /check-all
│   │   ├── jira-search.ts         # GET  /api/jira/search, /versions, /children; POST /api/jira/pull
│   │   ├── links.ts               # GET  /api/links/:type/:filename
│   │   │                          # POST|DELETE /api/link  (hierarchy + blocks deps)
│   │   ├── bugs.ts                # POST /api/bugs/create, GET /api/bugs/attachments
│   │   ├── bugs-dashboard.ts      # GET  /api/bugs/dashboard (SSE) — JIRA bug time-series/stats
│   │   ├── stories.ts             # POST /api/stories/generate
│   │   ├── settings.ts            # GET|PUT /api/settings/*, GET /api/config
│   │   ├── skills.ts              # GET|PUT|DELETE /api/skills, product context
│   │   ├── canvas.ts              # Refine-canvas layout persistence
│   │   ├── confluence.ts          # Confluence export/snapshot routes
│   │   ├── export.ts              # PDF/PPTX export routes
│   │   ├── ai-savings.ts          # AI cost/savings tracking routes
│   │   └── health.ts              # GET /api/health
│   │
│   ├── services/
│   │   ├── docIndex.ts            # In-memory Map<filename, metadata>; O(1) lookups;
│   │   │                          #   invalidated per-write, invalidateMany() on batch ops
│   │   ├── claudeService.ts       # Spawns `claude -p` subprocess; MOCK_CLAUDE=1 stubs it
│   │   ├── aiService.ts           # generate/upgrade/split-story orchestration
│   │   ├── aiPromptBuilder.ts     # Prompt construction for Claude calls
│   │   ├── jiraService.ts         # JIRA REST helpers, markdown↔JIRA wiki conversion
│   │   ├── jiraPushService.ts     # Push-to-JIRA orchestration
│   │   ├── jiraSprintService.ts   # Sprint/rank push logic
│   │   ├── jiraValidator.ts       # JIRA payload validation
│   │   ├── storyService.ts        # Parse / serialize multi-story .md files
│   │   ├── eventService.ts        # SSE broadcast to all connected clients
│   │   ├── bugService.ts          # HTML→segments, MSG parsing, PDF buffer, translate
│   │   ├── batchService.ts        # Batch-delete/fix-version/rerank/distribution logic
│   │   ├── distributionService.ts # Sprint distribution algorithm
│   │   ├── linksService.ts        # Hierarchy + blocks-dependency graph logic
│   │   ├── docPatch.ts            # Frontmatter patch application
│   │   ├── confluenceService.ts, confluenceSnapshotStore.ts  # Confluence export
│   │   ├── aiSavingsService.ts    # AI cost/savings computation
│   │   ├── exportLayout.ts        # PDF/PPTX layout helpers
│   │   ├── providers/             # Pluggable AI provider adapters
│   │   └── inboxWatcher.ts        # fs.watch on /inbox/, auto-processes dropped files
│   │
│   ├── schemas/                   # zod request-body schemas (also feed the OpenAPI spec)
│   ├── middleware/
│   │   └── rateLimiter.ts         # express-rate-limit config
│   │
│   └── utils/
│       ├── transforms.ts          # Pure fns: slugify, isoDate, extractTitle,
│       │                          #   setFrontmatterField, removeFrontmatterField,
│       │                          #   markdownToJira, jiraToMarkdown, …
│       ├── routeHelpers.ts        # sendError, parseApiError, assertDocType,
│       │                          #   assertFilename, assertStatus, resolveDocPath
│       ├── docHelpers.ts          # findExistingByJiraId and other doc lookups
│       ├── frontmatter.ts         # Frontmatter parsing primitives
│       ├── validate.ts, validateMiddleware.ts  # zod request validation
│       ├── auditLog.ts            # Structured audit log writer
│       ├── circuitBreaker.ts      # Circuit breaker for external calls
│       ├── logger.ts              # Structured logging
│       ├── pMap.ts                # Bounded-concurrency async map
│       ├── requestLogger.ts       # HTTP request logging middleware
│       └── topoSort.ts            # Topological sort (dependency cycle detection)
│
├── public/
│   ├── css/                       # base, layout, components, list, roadmap, jira, bugs, …
│   │
│   ├── ts/                        # Frontend source — ES modules, no window.* assignments
│   │   ├── state.ts               # Shared state (allDocs, piSettings, sprintConfig, …)
│   │   ├── list.ts, list-render.ts, list-filters.ts  # Swimlane rendering, rank sort, filters
│   │   ├── dragdrop.ts            # Mouse-event drag: link drop, PI-move drop, rerank
│   │   ├── detail.ts, detail-fields.ts, detail-links.ts  # Detail view, hierarchy, status
│   │   ├── upgrade.ts             # Upgrade panel (SSE streaming)
│   │   ├── quickcreate.ts         # Quick-create from detail view
│   │   ├── stories.ts             # Story cards: generate, upgrade, delete
│   │   ├── jira-import.ts, jira-pull.ts, jira-push.ts  # JIRA import, pull, push
│   │   ├── roadmap.ts + roadmap-*.ts  # Roadmap board, drag, select, JIRA sync, context menus
│   │   ├── refine.ts + refine-*.ts  # Refine/upgrade canvas (nodes, edges)
│   │   ├── canvasLayout.ts        # Pure layout math for the refine canvas (unit-tested)
│   │   ├── distribution.ts        # Sprint distribution modal + dep warning toast
│   │   ├── piconfig.ts            # PI & sprint configuration panel
│   │   ├── bugcreate.ts, bugs-dashboard.ts  # Bug reporter panel + JIRA bug dashboard
│   │   ├── documentation.ts       # Docs/skills browser panel
│   │   ├── skills.ts              # Skills CRUD panel
│   │   ├── export.ts, ai-savings.ts, provider-settings.ts
│   │   ├── theme.ts               # Dark / light theme toggle
│   │   ├── sse-client.ts, store.ts, ui-helpers.ts  # Shared SSE/store/DOM helpers
│   │   └── main.ts                # Bootstrap: loadDocs, SSE listener, init (load last)
│   │
│   └── js/                        # Compiled output of public/ts/*.ts — generated via
│                                   #   `npm run build:frontend`, committed alongside the TS
│                                   #   source (the CI "frontend-drift" check fails a PR
│                                   #   whose public/js/ doesn't match its public/ts/ source)
│
├── tests/
│   ├── unit/                      # Pure-function tests — run `npm test` for the current suite
│   ├── integration/                # HTTP tests against a real isolated Express instance
│   ├── e2e/                        # Playwright specs (`npm run test:e2e`)
│   ├── bench/                      # Performance benchmarks (`npm run test:bench`)
│   └── helpers/
│       └── testApp.js              # Starts an isolated Express instance in a temp dir
│                                   #   for each integration test suite
│
├── docs/
│   ├── features/                  # Generated Feature documents
│   ├── epics/                     # Generated Epic documents
│   ├── stories/                   # Generated Story documents
│   ├── spikes/                    # Generated Spike documents
│   └── bugs/
│       └── attachments/           # <slug>/ dirs — uploaded to JIRA on bug push
│
├── inbox/                         # Drop raw idea files here for auto-processing
├── .claude/commands.example/       # Generic command templates (tracked)
├── .claude/commands/               # Custom command overrides (gitignored)
├── .product-context.example.md    # Product context template (tracked)
├── .product-context.md            # Custom product context (gitignored)
├── CLAUDE.md                      # PO Agent persona + product context
├── manifest.json                  # PWA manifest
└── sw.js                          # Service worker (offline cache)
```

---

## API reference

### Documents

| Method   | Path                               | Description                                                 |
| :------- | :--------------------------------- | :---------------------------------------------------------- |
| `GET`    | `/api/docs`                        | All documents (from in-memory index)                        |
| `GET`    | `/api/doc/:type/:filename`         | Single document content                                     |
| `PATCH`  | `/api/doc/:type/:filename`         | Update status, title, fixVersion, storyPoints, sprint, rank |
| `DELETE` | `/api/doc/:type/:filename`         | Delete a document                                           |
| `POST`   | `/api/docs/draft`                  | Create a draft without AI                                   |
| `POST`   | `/api/generate`                    | Generate a document with Claude (SSE stream)                |
| `POST`   | `/api/doc/:type/:filename/upgrade` | Regenerate with feedback (SSE stream)                       |
| `POST`   | `/api/docs/split-story`            | AI-split a story into N parts (SSE stream)                  |
| `POST`   | `/api/docs/batch-delete`           | Delete multiple documents                                   |
| `POST`   | `/api/docs/batch-fix-version`      | Set fix-version on multiple documents                       |
| `POST`   | `/api/docs/rerank`                 | Batch-assign `Rank` fields in a given order                 |
| `POST`   | `/api/docs/distribute`             | Propose sprint assignments (greedy fill)                    |
| `POST`   | `/api/docs/apply-distribution`     | Write sprint assignments; returns `depWarnings`             |

### Links

| Method   | Path                         | Description                                              |
| :------- | :--------------------------- | :------------------------------------------------------- |
| `GET`    | `/api/links/:type/:filename` | Hierarchy parent + children + `blocks[]` + `blockedBy[]` |
| `POST`   | `/api/link`                  | Create hierarchy link or `linkType: 'blocks'` dependency |
| `DELETE` | `/api/link`                  | Remove a `linkType: 'blocks'` dependency                 |

### JIRA

| Method | Path                                         | Description                               |
| :----- | :------------------------------------------- | :---------------------------------------- |
| `POST` | `/api/jira/push/:type/:filename`             | Push local doc to JIRA (create or update) |
| `POST` | `/api/jira/push-rank`                        | Reorder issue in JIRA backlog             |
| `POST` | `/api/jira/pull`                             | Import a JIRA issue as a local `.md`      |
| `POST` | `/api/jira/sync-status/:type/:filename`      | Pull JIRA status + SP into local file     |
| `POST` | `/api/jira/update-from-jira/:type/:filename` | Full field sync from JIRA                 |
| `GET`  | `/api/jira/search`                           | Keyword search in JIRA project            |
| `GET`  | `/api/jira/versions`                         | Active fix-versions from JIRA             |
| `GET`  | `/api/jira/children/:key`                    | Epic children from JIRA                   |

### Settings

| Method    | Path                               | Description                        |
| :-------- | :--------------------------------- | :--------------------------------- |
| `GET`     | `/api/config`                      | Public server config (jiraBase)    |
| `GET/PUT` | `/api/settings/pi`                 | Current and next PI names          |
| `GET/PUT` | `/api/settings/pi/split-threshold` | Story-split SP threshold           |
| `GET/PUT` | `/api/settings/pi/sprints/:piName` | Sprint names + capacities for a PI |
| `GET/PUT` | `/api/settings/model`              | Claude model settings              |

---

## Running tests

```bash
npm test                  # unit + integration tests
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
npm run test:e2e          # Playwright end-to-end tests
npm run test:bench        # performance benchmarks
```

Tests use Node's built-in `node:test` runner — no extra dependencies.

Integration tests start a real Express instance in an isolated temp directory per suite, so they never touch your actual `docs/` data. JIRA HTTP calls are stubbed via `mock.method(globalThis, 'fetch', ...)`. Claude subprocess calls are stubbed via `MOCK_CLAUDE=1`.

### Test coverage

The suite is split across `tests/unit/` (pure functions and services), `tests/integration/` (HTTP tests against a real isolated Express instance), and `tests/e2e/` (Playwright, browser-driven). It's grown substantially since this project's early days — rather than hand-list every suite here (which reliably goes stale), run `npm test` or browse the relevant `tests/*` directory for the current, authoritative list.

---

## Dependency system

Stories, spikes, and bugs can declare ordering dependencies:

```yaml
# Story A (must come before Story B):
Blocks: 2026-05-02-story-b.md

# Story B (must come after Story A):
Blocked_By: 2026-05-01-story-a.md
```

**Creating a dependency:** hover any leaf item in the list view or roadmap → click ⛓ → pick the story this one must precede → click **Add Block**.

**Cycle detection:** the server runs a DFS from the target story before writing; if the path loops back to the source, the request returns `400 CYCLE_DETECTED`.

**Sprint enforcement:** `POST /api/docs/apply-distribution` validates that every blocker is assigned to a strictly earlier sprint than its blocked story. Violations are returned as `depWarnings` and shown as a toast in the UI.

**Removing a dependency:** click ⛓ → click × next to the entry. Both the `Blocks` line on the source and the `Blocked_By` line on the target are removed entirely (not set to `TBD`).

---

## In-memory document index

`src/services/docIndex.ts` builds a `Map<filename, metadata>` on startup by reading every markdown file once. All `GET /api/docs` requests and JIRA lookup operations (`findByJiraId`) hit the map — no per-request file I/O.

Invalidation strategy:

- **Single write** (PATCH, push, pull, link): `docIndex.invalidate(docType, filename)` — rebuilds one entry
- **Batch write** (batch-delete, batch-fix-version, rerank, apply-distribution): `docIndex.invalidateMany(filenames)` — re-reads only the affected files
- **Full rebuild**: `docIndex.invalidateAll()` exists for the rare case where the exact changed filenames aren't known (e.g. the test-only `/api/docs/rebuild-index` endpoint); everyday routes should prefer the targeted `invalidate`/`invalidateMany` calls above

Each index entry contains: `filename`, `docType`, `title`, `date`, `status`, `fixVersion`, `jiraId`, `jiraUrl`, `storyPoints`, `sprint`, `rank`, `priority`, `parentFilename`, `parentType`, `blocks[]`, `blockedBy[]`, `hasDescription`.

---

## Customizing Skills (command templates)

This tool ships with 7 generic command templates in `.claude/commands.example/`. Each template uses the COVE Framework and is product-agnostic — ready for any Product Owner to customize for their own product.

### The template pattern

```
.claude/commands.example/*.md   ← generic templates (tracked in git)
.claude/commands/*.md           ← your customized versions (gitignored)
```

When the app loads a command, it checks `.claude/commands/` first, then falls back to `.claude/commands.example/`. This is the same pattern as `.env.example` → `.env`.

### Product Context

Instead of editing all 7 templates individually, configure your product details once in **Product Context**:

1. Open the **Skills** view from the sidebar
2. Expand the **Product Context** section
3. Fill in your product name, data model, personas, tech stack, and delivery framework
4. Click **Save**

All templates reference `{{PRODUCT_CONTEXT}}`, which is replaced at runtime with your saved context. The example template (`.product-context.example.md`) provides a guided structure.

For file-based setup: copy `.product-context.example.md` to `.product-context.md` and edit it directly.

### Editing commands via the UI

1. Open **Skills** from the sidebar
2. Expand any command card to see its full template
3. Edit the textarea content
4. Click **Save** — the file is written to `.claude/commands/{name}.md`
5. Badge changes from "Template" to "Custom"
6. Click **Reset to Template** to revert to the example version

### Editing commands via files

For advanced users or version control:

```bash
# Copy a template to customize it
cp .claude/commands.example/create-epics.md .claude/commands/create-epics.md

# Edit directly
vim .claude/commands/create-epics.md
```

### AI Improve

Each command editor includes an **AI Improve** button that sends the current template to the configured AI provider with a meta-prompt asking for prompt engineering improvements. The improved version replaces the textarea (unsaved) so you can review before saving.

### Template structure

Every command template must include:

- **YAML frontmatter** — `name` and `description` fields between `---` markers
- **`$ARGUMENTS`** — placeholder where user input (title + description) is injected
- **`{{PRODUCT_CONTEXT}}`** — placeholder for shared product context (optional but recommended)
- **COVE sections** — Context, Objective, Value, Execution

### Migration for existing installations

If you already have custom commands tracked by git, untrack them:

```bash
git rm --cached .claude/commands/*.md
```

The `.gitignore` already excludes `.claude/commands/` and `.product-context.md`.

### Skills API

| Method   | Path                            | Description                      |
| :------- | :------------------------------ | :------------------------------- |
| `GET`    | `/api/skills`                   | List all 7 commands with content |
| `GET`    | `/api/skills/:name`             | Single command details           |
| `PUT`    | `/api/skills/:name`             | Save custom command              |
| `DELETE` | `/api/skills/:name`             | Reset to example template        |
| `PUT`    | `/api/skills/:name/improve`     | AI-improve a command template    |
| `GET`    | `/api/settings/product-context` | Get product context              |
| `PUT`    | `/api/settings/product-context` | Save product context             |
| `DELETE` | `/api/settings/product-context` | Reset product context to example |

---

## Auto-inbox processing

Drop any `.md` file into `/inbox/`:

1. `inboxWatcher.ts` detects the file via `fs.watch`
2. Claude CLI reads the raw idea against the matching skill prompt (e.g. `create-epics.md`)
3. The polished document is saved to the correct `docs/` subfolder
4. All open browser tabs refresh via SSE

To refine an existing document, drop a `feedback.md` referencing the target file — Claude amends it in place. The **Upgrade** button in the detail view provides the same capability inline with a streaming preview.
