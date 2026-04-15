# Backlog Claude

A minimal PWA + Claude Code PO Agent that transforms rough ideas into polished Epics.

## How it works

```
[PWA] → idea typed → .md file downloaded → dropped in /inbox
                                                    ↓
                                          [Claude PO Agent]
                                                    ↓
                                       Full Epic + Stories in /backlog
```

## Workflow

1. Open `index.html` in a browser (or install as PWA).
2. Type your idea and click **Generate Epic & Save to Inbox**.
3. Move the downloaded `.md` file into the `/inbox` folder.
4. Open Claude Code in this directory — it reads `CLAUDE.md` and acts as your PO Agent.
5. Claude processes the file and writes the polished Epic to `/backlog`.

## Folder Structure

```
backlog-claude/
├── index.html          # PWA entry point
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline support)
├── CLAUDE.md           # PO Agent instructions for Claude Code
├── inbox/              # Drop raw idea files here
├── backlog/            # Polished Epics & Stories land here
└── docs/
    ├── prd/            # Small PRDs
    ├── epics/          # COVE-framework Epics
    └── stories/        # COVE-framework User Stories
```

## Feedback Loop

To refine an existing Epic, drop a `feedback.md` file in `/inbox` that references the backlog file you want updated. Claude will amend it in place.

## COVE Framework

| Component | Description |
|:---|:---|
| **C - Context** | Why are we building this now? |
| **O - Objective** | The specific goal of this ticket. |
| **V - Value** | The "So What?" for the user or business. |
| **E - Execution** | High-level technical steps. |
