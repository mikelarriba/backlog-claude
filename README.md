# Backlog Claude

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
npm start          # node --watch server.js  (auto-restarts on file changes)

# 4. Open the app
open http://localhost:3000
```

---

## Environment variables

| Variable | Required | Description |
|:---|:---|:---|
| `JIRA_BASE_URL` | For JIRA | e.g. `https://your-org.atlassian.net/jira` |
| `JIRA_API_TOKEN` | For JIRA | Personal Access Token — all JIRA routes return 503 if unset |
| `JIRA_PROJECT` | For JIRA | Project key (e.g. `MID`) |
| `JIRA_LABEL` | For JIRA | Label applied to every created issue |
| `PORT` | No | HTTP port (default: `3000`) |
| `MOCK_CLAUDE` | Tests only | Set to `1` to skip the Claude subprocess in integration tests |

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

| Component | Description |
|:---|:---|
| **C — Context** | Why are we building this now? |
| **O — Objective** | The specific, measurable goal of this ticket |
| **V — Value** | The "So What?" — benefit to users or the business |
| **E — Execution** | High-level technical steps (always states V1 or V2) |

---

## Document types

| Type | Description | Directory |
|:---|:---|:---|
| **Feature** | High-level strategic capability grouping | `docs/features/` |
| **Epic** | Scoped body of work within a Feature (one PI) | `docs/epics/` |
| **Story** | Sprint-sized user-facing requirement | `docs/stories/` |
| **Spike** | Time-boxed technical research task | `docs/spikes/` |
| **Bug** | Defect report with structured reproduction steps | `docs/bugs/` |

Hierarchy: `Feature → Epic → Story / Spike / Bug`

Links are stored as `Feature_ID` / `Epic_ID` fields in YAML frontmatter. Story dependencies are stored as `Blocks` / `Blocked_By` comma-separated filename lists.

---

## Frontmatter reference

Every document starts with a YAML frontmatter block:

```yaml
---
JIRA_ID: MID-1234          # TBD until pushed to JIRA
JIRA_URL: https://...      # written automatically on push
Story_Points: 5            # TBD until estimated
Status: Draft              # Draft | Created in JIRA | Archived
Priority: High             # Critical | Major | High | Medium | Low
Fix_Version: PI-2026-Q2    # matches a configured PI name
Squad: TBD
PI: TBD
Sprint: Sprint-3           # assigned manually or via distribution
Rank: 4                    # integer; controls list order within type
Created: 2026-05-08
Epic_ID: 2026-04-01-my-epic.md        # for stories/spikes/bugs
Feature_ID: 2026-03-01-my-feature.md  # for epics
Blocks: 2026-05-02-story-b.md         # comma-separated; this story must come first
Blocked_By: 2026-04-30-story-a.md     # comma-separated; this story must come after
---
```

---

## Project structure

```
backlog-claude/
├── server.js                      # Entry point: mounts routes, SSE, static files
├── index.html                     # App shell
│
├── src/
│   ├── routes/
│   │   ├── docs-crud.js           # GET /api/docs, GET|PATCH|DELETE /api/doc, POST /api/docs/draft
│   │   ├── docs-ai.js             # POST /api/generate, /upgrade, /split-story (SSE streaming)
│   │   ├── docs-batch.js          # POST /api/docs/batch-delete, /batch-fix-version,
│   │   │                          #      /distribute, /apply-distribution, /rerank
│   │   ├── jira-push.js           # POST /api/jira/push/:type/:filename, /push-rank
│   │   ├── jira-sync.js           # POST /api/jira/sync-status, /update-from-jira
│   │   ├── jira-search.js         # GET  /api/jira/search, /versions, /children
│   │   │                          # POST /api/jira/pull
│   │   ├── links.js               # GET  /api/links/:type/:filename
│   │   │                          # POST|DELETE /api/link  (hierarchy + blocks deps)
│   │   ├── bugs.js                # POST /api/bugs/create, GET /api/bugs/attachments
│   │   ├── stories.js             # POST /api/stories/generate
│   │   └── settings.js            # GET|PUT /api/settings/*, GET /api/config
│   │
│   ├── services/
│   │   ├── docIndex.js            # In-memory Map<filename, metadata>; O(1) lookups;
│   │   │                          # invalidated on every write, full rebuild on batch ops
│   │   ├── claudeService.js       # Spawns `claude -p` subprocess; MOCK_CLAUDE=1 stubs it
│   │   ├── jiraService.js         # JIRA REST helpers, markdown↔JIRA wiki conversion
│   │   ├── storyService.js        # Parse / serialize multi-story .md files
│   │   ├── eventService.js        # SSE broadcast to all connected clients
│   │   ├── bugService.js          # HTML→segments, MSG parsing, PDF buffer, translate
│   │   └── inboxWatcher.js        # fs.watch on /inbox/, auto-processes dropped files
│   │
│   └── utils/
│       ├── transforms.js          # Pure fns: slugify, isoDate, extractTitle,
│       │                          #   setFrontmatterField, removeFrontmatterField,
│       │                          #   markdownToJira, jiraToMarkdown, …
│       └── routeHelpers.js        # sendError, parseApiError, assertDocType,
│                                  #   assertFilename, assertStatus, resolveDocPath
│
├── public/
│   ├── css/
│   │   ├── base.css               # CSS variables, reset, dark/light theme
│   │   ├── layout.css             # App grid, left panel, right panel
│   │   ├── components.css         # Buttons, dialogs, toasts, forms, spinners
│   │   ├── list.css               # Swimlanes, doc items, drag states, dep badges,
│   │   │                          #   insertion line marker, dep-indented items
│   │   ├── swimlanes.css          # Swimlane-specific layout
│   │   ├── detail.css             # Detail view, hierarchy panel
│   │   ├── stories.css            # Story card grid
│   │   ├── jira.css               # JIRA import/search panel
│   │   ├── roadmap.css            # Roadmap board, epic timeline, story columns,
│   │   │                          #   dep badges, dependency modal
│   │   ├── distribution.css       # Sprint distribution modal
│   │   ├── split.css              # Story-split modal
│   │   ├── piconfig.css           # PI & sprint configuration panel
│   │   ├── refine.css             # Refine/upgrade panel
│   │   └── bugs.css               # Bug reporter panel
│   │
│   └── js/
│       ├── state.js               # Shared state (allDocs, piSettings, sprintConfig, …)
│       │                          #   + helper fns (escHtml, fetchJSON, postJSON, …)
│       ├── list.js                # Swimlane rendering, rank sort, dep badges, ⛓ button
│       ├── dragdrop.js            # Mouse-event drag: link drop, PI-move drop,
│       │                          #   rerank drop (insertion line marker)
│       ├── detail.js              # Detail view, hierarchy, status changes
│       ├── upgrade.js             # Upgrade panel (SSE streaming)
│       ├── quickcreate.js         # Quick-create from detail view
│       ├── stories.js             # Story cards: generate, upgrade, delete
│       ├── jira.js                # JIRA push, sync, search, pull
│       ├── roadmap.js             # Roadmap board, dep modal (openDepModal),
│       │                          #   card drag-drop for sprint assignment
│       ├── distribution.js        # Sprint distribution modal + dep warning toast
│       ├── piconfig.js            # PI & sprint configuration panel
│       ├── refine.js              # Refine panel
│       ├── bugcreate.js           # Bug reporter panel
│       ├── theme.js               # Dark / light theme toggle
│       └── main.js                # Bootstrap: loadDocs, SSE listener, init (load last)
│
├── tests/
│   ├── unit/
│   │   ├── transforms.test.js     # setFrontmatterField, removeFrontmatterField,
│   │   │                          #   markdownToJira, extractTitle, …
│   │   ├── storyService.test.js   # parseStorySections, serializeStoryFile
│   │   ├── jiraService.test.js    # jiraIssueToMarkdown, extractJiraSummary
│   │   ├── claudeService.test.js  # MOCK_CLAUDE stub behaviour
│   │   ├── eventService.test.js   # SSE broadcast
│   │   └── bugService.test.js     # translateToEnglish, textToPdfBuffer,
│   │                              #   processAttachment, parseMsgFile
│   │
│   └── integration/               # HTTP tests against a real isolated Express instance
│       ├── api.test.js            # CRUD, draft, PATCH (status/title/SP/sprint/rank),
│       │                          #   batch-delete, batch-fix-version, rerank,
│       │                          #   links (hierarchy + blocks), distribute,
│       │                          #   apply-distribution, generate (SSE)
│       ├── docs-extended.test.js  # batch-delete, distribute, split-story SSE,
│       │                          #   upgrade SSE, apply-distribution
│       ├── jira.test.js           # push, pull, sync-status, update-from-jira,
│       │                          #   search, versions, children (mocked fetch)
│       └── settings.test.js       # GET/PUT pi settings, split-threshold,
│                                  #   sprint config, model settings
│
├── helpers/
│   └── testApp.js                 # Starts an isolated Express instance in a temp dir
│                                  #   for each integration test suite
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
├── .claude/commands/              # Claude CLI skill prompts (create-epics.md, …)
├── CLAUDE.md                      # PO Agent persona + MIDAS product context
├── manifest.json                  # PWA manifest
└── sw.js                          # Service worker (offline cache)
```

---

## API reference

### Documents

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/api/docs` | All documents (from in-memory index) |
| `GET` | `/api/doc/:type/:filename` | Single document content |
| `PATCH` | `/api/doc/:type/:filename` | Update status, title, fixVersion, storyPoints, sprint, rank |
| `DELETE` | `/api/doc/:type/:filename` | Delete a document |
| `POST` | `/api/docs/draft` | Create a draft without AI |
| `POST` | `/api/generate` | Generate a document with Claude (SSE stream) |
| `POST` | `/api/doc/:type/:filename/upgrade` | Regenerate with feedback (SSE stream) |
| `POST` | `/api/docs/split-story` | AI-split a story into N parts (SSE stream) |
| `POST` | `/api/docs/batch-delete` | Delete multiple documents |
| `POST` | `/api/docs/batch-fix-version` | Set fix-version on multiple documents |
| `POST` | `/api/docs/rerank` | Batch-assign `Rank` fields in a given order |
| `POST` | `/api/docs/distribute` | Propose sprint assignments (greedy fill) |
| `POST` | `/api/docs/apply-distribution` | Write sprint assignments; returns `depWarnings` |

### Links

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/api/links/:type/:filename` | Hierarchy parent + children + `blocks[]` + `blockedBy[]` |
| `POST` | `/api/link` | Create hierarchy link or `linkType: 'blocks'` dependency |
| `DELETE` | `/api/link` | Remove a `linkType: 'blocks'` dependency |

### JIRA

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/api/jira/push/:type/:filename` | Push local doc to JIRA (create or update) |
| `POST` | `/api/jira/push-rank` | Reorder issue in JIRA backlog |
| `POST` | `/api/jira/pull` | Import a JIRA issue as a local `.md` |
| `POST` | `/api/jira/sync-status/:type/:filename` | Pull JIRA status + SP into local file |
| `POST` | `/api/jira/update-from-jira/:type/:filename` | Full field sync from JIRA |
| `GET` | `/api/jira/search` | Keyword search in JIRA project |
| `GET` | `/api/jira/versions` | Active fix-versions from JIRA |
| `GET` | `/api/jira/children/:key` | Epic children from JIRA |

### Settings

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/api/config` | Public server config (jiraBase) |
| `GET/PUT` | `/api/settings/pi` | Current and next PI names |
| `GET/PUT` | `/api/settings/pi/split-threshold` | Story-split SP threshold |
| `GET/PUT` | `/api/settings/pi/sprints/:piName` | Sprint names + capacities for a PI |
| `GET/PUT` | `/api/settings/model` | Claude model settings |

---

## Running tests

```bash
npm test                  # all 167 tests (unit + integration)
npm run test:unit         # unit tests only
npm run test:integration  # integration tests only
```

Tests use Node's built-in `node:test` runner — no extra dependencies.

Integration tests start a real Express instance in an isolated temp directory per suite, so they never touch your actual `docs/` data. JIRA HTTP calls are stubbed via `mock.method(globalThis, 'fetch', ...)`. Claude subprocess calls are stubbed via `MOCK_CLAUDE=1`.

### Test coverage (58 suites · 167 tests)

| Suite | What it covers |
|:---|:---|
| `transforms.test.js` | `setFrontmatterField`, `removeFrontmatterField`, `markdownToJira`, `extractTitle`, `extractWorkflowStatus`, `extractFrontmatterField` |
| `storyService.test.js` | `parseStorySections`, `serializeStoryFile` |
| `jiraService.test.js` | `jiraIssueToMarkdown`, `extractJiraSummary`, `LOCAL_TO_JIRA_TYPE` |
| `claudeService.test.js` | `MOCK_CLAUDE` stub, stream behaviour |
| `eventService.test.js` | `broadcast` SSE formatting |
| `bugService.test.js` | `translateToEnglish`, `textToPdfBuffer`, `processAttachment`, `parseMsgFile` |
| `api.test.js` | Full CRUD, draft, PATCH fields, batch ops, rerank, links, distribute, generate SSE |
| `docs-extended.test.js` | batch-delete, distribute, split-story SSE, upgrade SSE, apply-distribution |
| `jira.test.js` | push, pull, sync-status, update-from-jira, search, versions, children |
| `settings.test.js` | PI names, split-threshold, sprint config, model settings |

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

`src/services/docIndex.js` builds a `Map<filename, metadata>` on startup by reading every markdown file once. All `GET /api/docs` requests and JIRA lookup operations (`findByJiraId`) hit the map — no per-request file I/O.

Invalidation strategy:
- **Single write** (PATCH, push, pull, link): `docIndex.invalidate(docType, filename)` — rebuilds one entry
- **Batch write** (batch-delete, batch-fix-version, rerank, apply-distribution): `docIndex.invalidateAll()` — full rebuild

Each index entry contains: `filename`, `docType`, `title`, `date`, `status`, `fixVersion`, `jiraId`, `jiraUrl`, `storyPoints`, `sprint`, `rank`, `priority`, `parentFilename`, `parentType`, `blocks[]`, `blockedBy[]`, `hasDescription`.

---

## Auto-inbox processing

Drop any `.md` file into `/inbox/`:
1. `inboxWatcher.js` detects the file via `fs.watch`
2. Claude CLI reads the raw idea against the matching skill prompt (e.g. `create-epics.md`)
3. The polished document is saved to the correct `docs/` subfolder
4. All open browser tabs refresh via SSE

To refine an existing document, drop a `feedback.md` referencing the target file — Claude amends it in place. The **Upgrade** button in the detail view provides the same capability inline with a streaming preview.
