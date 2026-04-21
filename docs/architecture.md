# Architecture Overview

## Data flow

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (PWA)                                                   │
│  index.html + public/css/*.css + public/js/*.js                  │
│                                                                  │
│  Left panel: idea form          Right panel: detail view         │
│  ┌─────────────────────┐        ┌──────────────────────────┐    │
│  │ Idea text           │        │ Markdown rendered content │    │
│  │ Title (optional)    │        │ Status selector           │    │
│  │ Type: Epic/Story/…  │        │ Upgrade panel             │    │
│  │ Priority            │        │ Quick-create child docs   │    │
│  │ [Generate]          │        │ Stories section           │    │
│  └─────────────────────┘        │ Hierarchy (parent/child)  │    │
│                                  │ JIRA push / search / pull │    │
│                                  └──────────────────────────┘    │
└──────────────────┬───────────────────────┬───────────────────────┘
                   │ fetch (REST JSON)      │ EventSource (SSE)
                   ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  server.js  (Express + Node.js)                                  │
│                                                                  │
│  POST /api/generate                                              │
│    └─ claudeService.callClaude(prompt)                           │
│         └─ spawn("claude", ["-p", prompt])                       │
│              └─ reads .claude/commands/<type>.md skill prompt    │
│    └─ write to docs/<type>/<date>-<slug>.md                     │
│    └─ broadcast SSE event                                        │
│                                                                  │
│  PATCH /api/doc/:type/:file          update Status in frontmatter│
│  DELETE /api/doc/:type/:file         remove file from disk       │
│  GET    /api/doc/:type/:file         read file content           │
│  GET    /api/docs                    list all docs (all types)   │
│  GET    /api/links/:type/:file       parent / children hierarchy │
│  POST   /api/link                    write Epic_ID / Feature_ID  │
│                                                                  │
│  POST /api/doc/:type/:file/upgrade   regenerate with feedback    │
│    └─ claudeService.streamClaude(prompt, onChunk)               │
│                                                                  │
│  POST /api/epic/:file/stories        generate story cards        │
│  GET  /api/stories/:file             read multi-story file       │
│  POST /api/stories/:file/upgrade-story  upgrade one story card  │
│  DELETE /api/stories/:file/story     delete one story card      │
│                                                                  │
│  POST /api/jira/push/:type/:file     push local doc to JIRA     │
│  GET  /api/jira/search               search JIRA by keyword      │
│  POST /api/jira/pull                 import JIRA issue as .md   │
│                                                                  │
│  GET /api/events                     SSE stream (keep-alive)    │
│                                                                  │
│  inboxWatcher: fs.watch("/inbox/")                               │
│    └─ on new .md file → callClaude → save to docs/<type>/       │
└──────────────────────────────────────────────────────────────────┘
         │ fs read/write
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Filesystem                                                       │
│  docs/features/*.md    docs/epics/*.md                           │
│  docs/stories/*.md     docs/spikes/*.md                          │
│  inbox/*.md            (raw ideas, auto-processed)               │
└──────────────────────────────────────────────────────────────────┘
         │ REST / JIRA wiki markup
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  JIRA (external, optional)                                        │
│  Project: EAMDM   Label: MIDAS_Development                       │
│  Types: New Feature, Epic, Story, Task (=Spike)                  │
└──────────────────────────────────────────────────────────────────┘
```

## Key modules

### server.js
Single Express file. All routes, middleware, and startup logic.
- Reads `process.env.TEST_DOCS_ROOT` to redirect file I/O during tests.
- Exports `app` (no `app.listen` when imported as a module — only when run directly).
- `JIRA_TOKEN` guard is checked dynamically via `process.env.JIRA_API_TOKEN` so tests can control it.

### src/services/claudeService.js
Wraps the `claude` CLI subprocess.
- `callClaude(rootDir, prompt)` — returns full response string.
- `streamClaude(rootDir, prompt, onChunk)` — streams chunks to `onChunk`.
- Set `MOCK_CLAUDE=1` to bypass the CLI and return a canned stub response (used in tests).

### src/services/storyService.js
Parse and serialize multi-story `.md` files (`-stories.md`).
- `parseStorySections(content)` — splits frontmatter from `## Story N:` sections.
- `serializeStoryFile(frontmatter, sections)` — reassembles the file.
- `extractStoryTitle(section)` — pulls the `## Story N: Title` heading.

### src/services/jiraService.js
JIRA REST API v2 integration.
- `jiraRequest(method, path, body)` — authenticated fetch wrapper.
- `jiraIssueToMarkdown(issue)` — converts a JIRA issue to a COVE-structured `.md` file.
- `findLocalFileByJiraId(jiraId)` — scans all docs dirs for a matching `JIRA_ID`.

### src/services/eventService.js
Server-Sent Events (SSE) for live UI updates.
- `handleEvents(req, res)` — registers a client connection.
- `broadcast(payload)` — sends a JSON payload to all connected clients.
- Clients reload the doc list on `feature_created`, `epic_created`, `story_created`, `spike_created`, `status_updated`, `doc_deleted`.

### src/services/inboxWatcher.js
Watches `/inbox/` with `fs.watch`. On new `.md` files:
1. Detects the doc type from the filename or content.
2. Calls the matching skill prompt via `callClaude`.
3. Saves the result to `docs/<type>/`.
4. Broadcasts an SSE event.

### src/utils/transforms.js
Pure functions with no side effects — fully unit-tested.
- `slugify(text)` — URL-safe lowercase slug (50-char max).
- `isoDate()` — `YYYY-MM-DD` string for today.
- `extractTitle(content)` — extracts the first `#` or `## Epic Title` heading.
- `extractWorkflowStatus(content)` — reads `Status:` from frontmatter.
- `setFrontmatterField(content, field, value)` — upserts a YAML frontmatter field.
- `markdownToJira(md)` — converts Markdown to JIRA wiki markup.

### .claude/commands/*.md
Skill prompts used by Claude CLI:
- `create-epics.md` — turns a raw idea into a COVE Epic.
- `create-stories.md` — creates a User Story from a raw idea.
- `create-spikes.md` — creates a Research Spike.
- `create-features.md` — creates a high-level Feature.
- `refine-epics.md` — improves an existing Epic with feedback.

### public/js/ (load order matters — no ES modules)
Scripts share global scope via `<script>` tags. Load order:
1. `state.js` — all `var` globals + shared helpers (must load first)
2. `list.js`, `detail.js`, `upgrade.js`, `quickcreate.js`, `stories.js`, `jira.js`, `dragdrop.js`
3. `main.js` — bootstrap: `loadDocs()`, `initDragDrop()`, SSE listener (must load last)

## Document format

All docs use YAML frontmatter + Markdown body:

```markdown
---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: Medium
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-04-21
---

## Epic Title

My Epic Name Here

## Context
...

## Objective
...

## Value
...

## Execution
...

## Acceptance Criteria
- Given …, When …, Then …

## Out of Scope
...
```

### Hierarchy links (in frontmatter)
- `Feature_ID: <filename>` — set on Epics to link to a parent Feature.
- `Epic_ID: <filename>` — set on Stories/Spikes to link to a parent Epic.

These are written by the **Link** action (drag-drop or explicit POST /api/link).

## Test architecture

```
tests/
├── unit/            No server; import pure functions directly
│   ├── transforms.test.js
│   └── storyService.test.js
├── integration/     Start Express on a random port with temp dirs
│   ├── api.test.js  (generate, status, get, delete, links)
│   └── jira.test.js (503 guards, validation, mocked happy path)
└── helpers/
    └── testApp.js   Sets TEST_DOCS_ROOT, TEST_INBOX_DIR, MOCK_CLAUDE=1,
                     JIRA_API_TOKEN='' then dynamically imports server.js
```

All tests use Node's built-in `node:test` + `node:assert`. No external test dependencies.
