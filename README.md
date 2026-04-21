# Backlog Claude

A full-stack PWA + AI Product Owner agent that transforms rough ideas into sprint-ready Epics, Stories, Spikes, and Features using the **COVE Framework** and **Claude AI**.

## How it works

```
Browser (PWA)
   │  POST /api/generate (idea + type)
   ▼
Express Server
   │  Calls Claude CLI to generate the document
   ▼
docs/epics|stories|spikes|features/*.md   ← structured COVE doc saved to disk
   │
   ├─ Broadcast SSE event → all open tabs reload automatically
   ├─ JIRA push (POST /api/jira/push)  → creates/updates issue
   └─ JIRA pull (POST /api/jira/pull)  → imports issue as local .md
```

For docs dropped directly into `/inbox/`, `fs.watch` detects them and auto-processes them via Claude (same pipeline, no browser needed).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env   # set JIRA_BASE_URL and JIRA_API_TOKEN if you use JIRA

# 3. Start the server
npm start               # runs node --watch server.js

# 4. Open http://localhost:3000 in your browser
```

## Folder structure

```
backlog-claude/
├── server.js                   # Express API + SSE + JIRA integration
├── index.html                  # App shell (loads from public/)
├── public/
│   ├── css/                    # Modular stylesheets
│   │   ├── base.css            #   CSS variables, reset, animations
│   │   ├── layout.css          #   App grid, left/right panels
│   │   ├── components.css      #   Forms, buttons, dialogs, toasts
│   │   ├── list.css            #   Doc list, filters, drag-drop
│   │   ├── detail.css          #   Detail view, upgrade panel
│   │   ├── stories.css         #   Story cards
│   │   └── jira.css            #   JIRA import section
│   └── js/                     # Modular client scripts (global scope, load order matters)
│       ├── state.js            #   All shared state + helper functions (load first)
│       ├── list.js             #   Doc list rendering and filters
│       ├── detail.js           #   Detail view, hierarchy, status
│       ├── upgrade.js          #   Upgrade panel (regenerate with feedback)
│       ├── quickcreate.js      #   Quick-create panel (create from detail view)
│       ├── stories.js          #   Story cards: generate, upgrade, delete
│       ├── jira.js             #   JIRA push, search, pull
│       ├── dragdrop.js         #   Mouse-event drag-drop linking
│       └── main.js             #   Bootstrap: loadDocs, SSE, delete overlay (load last)
├── src/
│   ├── services/
│   │   ├── claudeService.js    # Spawns `claude -p` subprocess; MOCK_CLAUDE=1 for tests
│   │   ├── storyService.js     # Parse / serialize multi-story .md files
│   │   ├── jiraService.js      # JIRA REST API helpers + markdown↔JIRA conversion
│   │   ├── eventService.js     # SSE broadcast to connected clients
│   │   └── inboxWatcher.js     # fs.watch on /inbox/, auto-processes dropped files
│   └── utils/
│       └── transforms.js       # Pure functions: slugify, extractTitle, markdownToJira, …
├── tests/
│   ├── unit/                   # Pure-function tests (no server needed)
│   │   ├── transforms.test.js
│   │   └── storyService.test.js
│   ├── integration/            # HTTP tests against a real (temp-dir) server instance
│   │   ├── api.test.js
│   │   └── jira.test.js
│   └── helpers/
│       └── testApp.js          # Starts isolated Express instance for integration tests
├── docs/
│   ├── epics/                  # Generated COVE Epics (.md)
│   ├── stories/                # Generated Stories (.md)
│   ├── spikes/                 # Generated Research Spikes (.md)
│   └── features/               # New Feature groupings (.md)
├── inbox/                      # Drop raw idea files here for auto-processing
├── .claude/commands/           # Claude CLI skill prompts (create-epics.md, etc.)
├── CLAUDE.md                   # PO Agent persona + MIDAS product context
├── manifest.json               # PWA manifest
└── sw.js                       # Service worker (offline cache)
```

## Running tests

```bash
npm test                # all 57 tests (unit + integration)
npm run test:unit       # 34 unit tests only
npm run test:integration # 23 integration tests only
```

Tests use Node's built-in `node:test` runner — no extra dependencies needed.

## COVE Framework

Every generated document follows this structure:

| Component | Description |
|:---|:---|
| **C — Context** | Why are we building this now? |
| **O — Objective** | The specific, measurable goal of this ticket. |
| **V — Value** | The "So What?" — benefit to users or the business. |
| **E — Execution** | High-level technical steps. Always states V1 or V2. |

## Document types

| Type | Description | Dir |
|:---|:---|:---|
| **Feature** | High-level capability grouping (e.g. "Export V2") | `docs/features/` |
| **Epic** | Scoped body of work within a Feature | `docs/epics/` |
| **Story** | Sprint-sized user-facing requirement | `docs/stories/` |
| **Spike** | Time-boxed technical research | `docs/spikes/` |

Hierarchy: Feature → Epic → Story / Spike. Links are stored as `Feature_ID` / `Epic_ID` fields in the YAML frontmatter.

## JIRA integration

Set the following in `.env`:

```
JIRA_BASE_URL=https://your-jira-instance.com/jira
JIRA_API_TOKEN=your-personal-access-token
```

- **Push**: converts the local `.md` file to JIRA wiki markup and creates or updates the issue.
- **Pull**: imports a JIRA issue as a local `.md` file using the COVE structure.
- **Search**: searches by keyword within the configured project.

If `JIRA_API_TOKEN` is not set, all JIRA endpoints return `503`.

## Auto-inbox processing

Any `.md` file dropped into `/inbox/` is picked up by `fs.watch` and processed automatically:
1. Claude CLI reads the raw idea against the matching skill prompt (e.g. `create-epics.md`).
2. The polished document is saved to the appropriate `docs/` subfolder.
3. All connected browser tabs refresh via SSE.

## Feedback loop

To refine an existing document, drop a `feedback.md` file in `/inbox/` that references the target file. Claude will amend it in place. You can also use the **Upgrade** button in the detail view for inline regeneration with feedback.
