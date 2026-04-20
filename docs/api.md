# Backlog Claude API Reference (Phase 1)

This document captures the current HTTP API behavior and the Phase 1 response conventions.

## Base URL

- Local: `http://localhost:3000`

## Response Conventions

- Success responses keep their endpoint-specific payloads.
- Error responses now use a shared shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

- `details` is optional and only present for validation/context metadata.

## Common Error Codes

- `VALIDATION_ERROR`
- `INVALID_TYPE`
- `INVALID_STATUS`
- `INVALID_FILENAME`
- `NOT_FOUND`
- `JIRA_NOT_CONFIGURED`
- `INTERNAL_ERROR`

## Main Endpoints

### Documents

- `POST /api/generate`
  - Creates an epic/story/spike from `idea`, optional `title`, `priority`, and `type`.
- `GET /api/docs`
  - Returns all docs across epics/stories/spikes.
- `GET /api/doc/:type/:filename`
  - Returns one document content.
- `PATCH /api/doc/:type/:filename`
  - Updates workflow status (`Draft`, `Created in JIRA`, `Archived`).
- `DELETE /api/doc/:type/:filename`
  - Deletes one document file.
- `POST /api/doc/:type/:filename/upgrade`
  - Streams upgraded doc content using server-sent events (SSE).

### Stories

- `GET /api/stories/:filename`
  - Returns parsed story sections from a stories file.
- `POST /api/stories/:filename/upgrade-story`
  - Streams a regenerated single story section.
- `DELETE /api/stories/:filename/story`
  - Deletes a story section by index.
- `POST /api/epic/:filename/stories`
  - Streams stories generation from one epic.

### Inbox

- `GET /api/inbox/:filename`
  - Returns original inbox markdown file if present.

### Events (SSE)

- `GET /api/events`
  - Pushes realtime updates (`epic_created`, `story_created`, `spike_created`, `status_updated`, `doc_deleted`).

### JIRA

- `POST /api/jira/push/:type/:filename`
  - Creates or updates issue(s) in JIRA from local markdown.
- `GET /api/jira/search?type=all|epic|story|spike&text=...`
  - Searches JIRA issues tagged for MIDAS.
- `POST /api/jira/pull`
  - Pulls selected JIRA issues to local files.

## Validation Highlights (Phase 1)

- `:type` parameters are validated against known types.
- `:filename` parameters are sanitized and rejected when invalid.
- Status updates are constrained to the supported workflow values.
- JIRA endpoints return `503` with `JIRA_NOT_CONFIGURED` when token is missing.
